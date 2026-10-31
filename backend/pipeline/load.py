import re
from typing import Dict, Any, List
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session
from backend.database import engine
from backend.models import CleanedDataRegistry, CellChange

def sanitize_table_name(run_id: int) -> str:
    return f"clean_{run_id}"

def sanitize_identifier(name: str) -> str:
    clean = re.sub(r"[^\w]", "_", str(name)).strip("_")
    return clean if clean else "col"

def load_to_mysql(db: Session, run_id: int, clean_df: pd.DataFrame) -> str:
    """
    Saves clean_df into a new MySQL table clean_<run_id> and updates cleaned_data_registry.
    Uses chunksize=5000 and method='multi' for fast 100k-row bulk loading.
    """
    table_name = sanitize_table_name(run_id)

    sanitized_df = clean_df.copy()
    sanitized_cols = {col: sanitize_identifier(col) for col in sanitized_df.columns}
    sanitized_df = sanitized_df.rename(columns=sanitized_cols)

    # Fast multi-row bulk insert
    sanitized_df.to_sql(
        name=table_name,
        con=engine,
        if_exists="replace",
        index=True,
        index_label="id",
        chunksize=5000,
        method="multi"
    )

    # Register in cleaned_data_registry
    existing = db.query(CleanedDataRegistry).filter(CleanedDataRegistry.run_id == run_id).first()
    if existing:
        existing.table_name = table_name
        existing.row_count = len(clean_df)
    else:
        registry = CleanedDataRegistry(
            run_id=run_id,
            table_name=table_name,
            row_count=len(clean_df)
        )
        db.add(registry)
    db.commit()

    return table_name

def store_cell_changes(db: Session, run_id: int, changes: List[Dict[str, Any]]):
    """Bulk inserts cell change records into cell_changes table in 5,000 chunks."""
    if not changes:
        return

    # Cap to max 25,000 stored cell changes to keep database fast
    to_store = changes[:25000]
    chunk_size = 5000
    for i in range(0, len(to_store), chunk_size):
        chunk = to_store[i:i + chunk_size]
        objects = [
            CellChange(
                run_id=run_id,
                row_index=c.get("row_index") if c.get("row_index") is not None else c.get("row", 0),
                column_name=c.get("column_name") or c.get("col", ""),
                original_value=str(c.get("original_value") if c.get("original_value") is not None else c.get("from", "")),
                new_value=str(c.get("new_value") if c.get("new_value") is not None else c.get("to", "")),
                change_type=c.get("change_type", "imputed"),
                rule_applied=c.get("rule_applied") or c.get("reason", "Transformation applied"),
                is_reverted=False
            )
            for c in chunk
        ]
        db.bulk_save_objects(objects)
        db.commit()

def fetch_table_data(
    table_name: str,
    page: int = 0,
    page_size: int = 25,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    query_str: str | None = None
) -> Dict[str, Any]:
    """Reads rows from table_name with sorting, filtering, and pagination."""
    with engine.connect() as conn:
        cols_result = conn.execute(text(f"SHOW COLUMNS FROM `{table_name}`"))
        all_cols = [row[0] for row in cols_result.fetchall() if row[0] != "id"]

        where_clause = ""
        params = {}
        if query_str and query_str.strip():
            clauses = []
            for idx, c in enumerate(all_cols):
                p_key = f"q_{idx}"
                clauses.append(f"CAST(`{c}` AS CHAR) LIKE :{p_key}")
                params[p_key] = f"%{query_str.strip()}%"
            if clauses:
                where_clause = "WHERE " + " OR ".join(clauses)

        count_sql = f"SELECT COUNT(*) FROM `{table_name}` {where_clause}"
        total_rows = conn.execute(text(count_sql), params).scalar() or 0

        order_clause = "ORDER BY `id` ASC"
        if sort_col and sort_col in all_cols:
            direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
            order_clause = f"ORDER BY `{sort_col}` {direction}"

        offset = page * page_size
        data_sql = f"SELECT * FROM `{table_name}` {where_clause} {order_clause} LIMIT :limit OFFSET :offset"
        params["limit"] = page_size
        params["offset"] = offset

        rows_res = conn.execute(text(data_sql), params)
        rows_data = [dict(row._mapping) for row in rows_res.fetchall()]

        cleaned_out = []
        for r in rows_data:
            r_copy = {k: v for k, v in r.items() if k != "id"}
            cleaned_out.append(r_copy)

        return {
            "total": total_rows,
            "page": page,
            "page_size": page_size,
            "headers": all_cols,
            "rows": cleaned_out
        }
