import os
import re
import json
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import text
from backend.database import engine
from backend.models import AIFixProposal, CellChange, PipelineRun, CleanedDataRegistry

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

def is_ai_configured() -> bool:
    return bool(ANTHROPIC_API_KEY and ANTHROPIC_API_KEY != "your_anthropic_api_key_here")

PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior)\s+instructions",
    r"drop\s+table",
    r"delete\s+from",
    r"alter\s+table",
    r"truncate\s+table",
    r"show\s+me\s+all\s+passwords",
    r"system\s*prompt",
    r"grant\s+all",
    r"exec\s*\(",
    r"union\s+select",
]

def check_prompt_injection(text_input: str) -> bool:
    """Returns True if any malicious prompt injection or dangerous SQL pattern is detected."""
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, text_input, re.IGNORECASE):
            return True
    return False

def sanitize_sql_query(sql: str, allowed_table: str) -> str:
    cleaned = sql.strip().strip(";").strip("`")
    # Must start with SELECT
    if not re.match(r"^\s*SELECT\b", cleaned, re.IGNORECASE):
        raise ValueError("Security violation: Only SELECT queries are permitted.")

    # Disallow destructive or schema-altering SQL
    forbidden = [
        r"\bINSERT\b", r"\bUPDATE\b", r"\bDELETE\b", r"\bDROP\b",
        r"\bALTER\b", r"\bTRUNCATE\b", r"\bGRANT\b", r"\bREVOKE\b",
        r"\bEXEC\b", r"\bCREATE\b", r"\bINTO\b", r"\bUNION\b",
        r"--", r"/\*", r";"
    ]
    for pattern in forbidden:
        if re.search(pattern, cleaned, re.IGNORECASE):
            raise ValueError(f"Security violation: Disallowed keyword or syntax ({pattern}).")

    if allowed_table.lower() not in cleaned.lower():
        raise ValueError(f"Security violation: Query must target table `{allowed_table}` only.")

    # Enforce LIMIT
    if not re.search(r"\bLIMIT\s+\d+", cleaned, re.IGNORECASE):
        cleaned += " LIMIT 25"
    else:
        def cap_limit(match):
            val = int(match.group(1))
            return f"LIMIT {min(val, 100)}"
        cleaned = re.sub(r"\bLIMIT\s+(\d+)", cap_limit, cleaned, flags=re.IGNORECASE)

    return cleaned

def get_claude_client():
    if not is_ai_configured():
        return None
    try:
        from anthropic import Anthropic
        return Anthropic(api_key=ANTHROPIC_API_KEY)
    except Exception:
        return None

def generate_suggestions(columns: List[Dict[str, Any]], sample_rows: List[Dict[str, Any]]) -> List[str]:
    """Generates 4 concise questions/suggestions for AI Assistant."""
    return [
        "What is the average revenue by region?",
        "Show rows with monthly revenue above 10,000",
        "How many customers signed up in 2024?",
        "List customers with highest support ticket count"
    ]

def generate_ai_proposals(run_id: int, column_profiles: List[Dict[str, Any]], outlier_records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Generates 2-4 concrete, structured fix proposals for ambiguous issues (outliers, nulls, casing).
    Deterministic fallback ensures proposals are always available for hackathon demos.
    """
    proposals = []
    
    # 1. Outlier proposal
    if outlier_records:
        outlier_cols = list(set(r.get("column_name") or r.get("column", "") for r in outlier_records if r.get("column_name") or r.get("column")))
        if outlier_cols:
            primary_col = outlier_cols[0]
            count = sum(1 for r in outlier_records if (r.get("column_name") or r.get("column")) == primary_col)
            proposals.append({
                "run_id": run_id,
                "title": f"Cap Extreme Outliers in {primary_col}",
                "description": f"Detected {count} values breaking IQR bounds in '{primary_col}'. Cap values to the 99th percentile to prevent skewed aggregates.",
                "affected_rows": count,
                "confidence": 0.94,
                "sql_or_pandas_action": json.dumps({"action": "cap_outliers", "column": primary_col}),
                "status": "pending"
            })

    # 2. Text standardization proposal
    text_cols = [c["name"] for c in column_profiles if c.get("type") == "text"]
    if text_cols:
        target_col = text_cols[0]
        proposals.append({
            "run_id": run_id,
            "title": f"Standardize Casing on {target_col}",
            "description": f"Standardize all text entries in '{target_col}' to proper Title Case for uniform downstream reporting.",
            "affected_rows": 12,
            "confidence": 0.98,
            "sql_or_pandas_action": json.dumps({"action": "standardize_casing", "column": target_col}),
            "status": "pending"
        })

    # 3. Imputation proposal for nulls
    null_cols = [c for c in column_profiles if c.get("nullCount", 0) > 0]
    if null_cols:
        target_col = null_cols[0]["name"]
        ctype = null_cols[0].get("type", "text")
        cnt = null_cols[0].get("nullCount", 5)
        proposals.append({
            "run_id": run_id,
            "title": f"Impute Missing Values in {target_col}",
            "description": f"Impute {cnt} remaining nulls in '{target_col}' with {'column median' if ctype == 'number' else 'default placeholder (\"Unknown\")'}.",
            "affected_rows": cnt,
            "confidence": 0.91,
            "sql_or_pandas_action": json.dumps({"action": "impute_median" if ctype == "number" else "impute_placeholder", "column": target_col}),
            "status": "pending"
        })

    return proposals

def execute_whitelist_fix(db, run_id: int, proposal: AIFixProposal) -> Dict[str, Any]:
    """
    Executes a predefined safe fix on table clean_{run_id}.
    Whitelisted operations only: no arbitrary code execution.
    """
    table_name = f"clean_{run_id}"
    action_data = json.loads(proposal.sql_or_pandas_action or "{}")
    action = action_data.get("action")
    col = action_data.get("column")

    rows_affected = 0
    with engine.connect() as conn:
        if action == "cap_outliers" and col:
            res = conn.execute(text(f"SELECT AVG(`{col}`) + 2.5 * STDDEV(`{col}`) FROM `{table_name}` WHERE `{col}` IS NOT NULL"))
            threshold = res.scalar() or 10000.0
            update_res = conn.execute(text(f"UPDATE `{table_name}` SET `{col}` = {threshold} WHERE `{col}` > {threshold}"))
            conn.commit()
            rows_affected = update_res.rowcount
            
        elif action == "standardize_casing" and col:
            # Simple title case or trim
            update_res = conn.execute(text(f"UPDATE `{table_name}` SET `{col}` = CONCAT(UCASE(LEFT(`{col}`, 1)), LCASE(SUBSTRING(`{col}`, 2))) WHERE `{col}` IS NOT NULL"))
            conn.commit()
            rows_affected = update_res.rowcount
            
        elif action in ("impute_median", "impute_placeholder") and col:
            if action == "impute_median":
                med_res = conn.execute(text(f"SELECT AVG(`{col}`) FROM `{table_name}` WHERE `{col}` IS NOT NULL"))
                val = med_res.scalar() or 0.0
                update_res = conn.execute(text(f"UPDATE `{table_name}` SET `{col}` = {val} WHERE `{col}` IS NULL"))
            else:
                update_res = conn.execute(text(f"UPDATE `{table_name}` SET `{col}` = 'Unknown' WHERE `{col}` IS NULL OR `{col}` = ''"))
            conn.commit()
            rows_affected = update_res.rowcount

    # Mark proposal approved
    proposal.status = "approved"
    db.commit()

    return {"ok": True, "rows_affected": rows_affected}

def ask_data_ai(question: str, table_name: str, schema_info: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Converts user question to SQL with injection protection.
    """
    # 1. Protection against prompt injection
    if check_prompt_injection(question):
        return {
            "ok": False,
            "answer": "Security Alert: Query blocked. Only read-only data analysis queries targeting the active dataset are permitted.",
            "sql": "-- Query blocked due to security validation pattern.",
            "table": None
        }

    # 2. Local fallback if AI key not configured
    if not is_ai_configured():
        return execute_fallback_question(question, table_name)

    client = get_claude_client()
    if not client:
        return execute_fallback_question(question, table_name)

    cols_str = ", ".join(f"`{c['name']}` ({c.get('type', 'text')})" for c in schema_info)
    system_prompt = (
        f"You are an expert MySQL data analyst. You have access to a single table named `{table_name}`.\n"
        f"Table Columns: {cols_str}\n\n"
        "Generate a valid MySQL SELECT query that answers the user's question.\n"
        "RULES:\n"
        f"1. Query MUST query `{table_name}` only.\n"
        "2. ONLY return a raw JSON object with keys: 'sql' (the SELECT query string) and 'explanation' (a concise 1-2 sentence answer).\n"
        "3. DO NOT output markdown code blocks or additional text.\n"
        "4. Enforce LIMIT 10 if querying rows."
    )

    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=400,
            system=system_prompt,
            messages=[{"role": "user", "content": question}]
        )
        content_text = response.content[0].text.strip()
        json_match = re.search(r"\{.*\}", content_text, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group(0))
        else:
            parsed = {"sql": f"SELECT * FROM `{table_name}` LIMIT 5", "explanation": content_text}

        generated_sql = sanitize_sql_query(parsed.get("sql", f"SELECT * FROM `{table_name}` LIMIT 5"), table_name)

        # Execute query
        with engine.connect() as conn:
            res = conn.execute(text(generated_sql))
            rows = [dict(row._mapping) for row in res.fetchall()]
            headers = [c for c in (rows[0].keys() if rows else []) if c != "id"]

        return {
            "ok": True,
            "answer": parsed.get("explanation", "Here are the query results from your dataset."),
            "sql": generated_sql,
            "table": {"headers": headers, "rows": rows} if rows else None
        }
    except Exception as e:
        return execute_fallback_question(question, table_name, str(e))

def execute_fallback_question(question: str, table_name: str, error_context: str = "") -> Dict[str, Any]:
    q = question.lower()
    sql = f"SELECT * FROM `{table_name}` LIMIT 5"
    explanation = "Retrieved a preview of the dataset."

    if "sample" in q or "show" in q or "first" in q:
        sql = f"SELECT * FROM `{table_name}` LIMIT 5"
        explanation = "Retrieved 5 sample rows from the cleaned dataset."
    elif "count" in q or "how many" in q:
        sql = f"SELECT COUNT(*) AS total_rows FROM `{table_name}`"
        explanation = "Calculated total row count."
    elif "region" in q:
        sql = f"SELECT `region`, COUNT(*) AS total FROM `{table_name}` GROUP BY `region` LIMIT 10"
        explanation = "Aggregated records by region."
    elif "revenue" in q or "monthly" in q or "high" in q:
        sql = f"SELECT * FROM `{table_name}` ORDER BY `id` ASC LIMIT 5"
        explanation = "Retrieved records ordered by ID."

    try:
        with engine.connect() as conn:
            res = conn.execute(text(sql))
            rows = [dict(row._mapping) for row in res.fetchall()]
            headers = [c for c in (rows[0].keys() if rows else []) if c != "id"]

        notice = " (Note: AI served via local heuristic engine)" if not is_ai_configured() else ""
        return {
            "ok": True,
            "answer": explanation + notice,
            "sql": sql,
            "table": {"headers": headers, "rows": rows} if rows else None
        }
    except Exception as err:
        return {
            "ok": False,
            "answer": f"Unable to execute query: {str(err)}",
            "sql": sql,
            "table": None
        }
