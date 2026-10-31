import re
from typing import Dict, Any, List, Tuple
import pandas as pd

PATTERNS = {
    "email": re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"),
    "phone": re.compile(r"^(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$|^\d{10}$"),
    "ssn": re.compile(r"^\d{3}-\d{2}-\d{4}$|^\d{9}$"),
    "aadhaar": re.compile(r"^\d{4}[\s-]?\d{4}[\s-]?\d{4}$"),
    "pan": re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$", re.I),
}

COLUMN_HINTS = {
    "email": ["email", "e_mail", "mail", "contact_email"],
    "phone": ["phone", "mobile", "cell", "telephone", "contact_number", "contact_no"],
    "ssn": ["ssn", "social_security"],
    "aadhaar": ["aadhaar", "aadhar", "national_id"],
    "pan": ["pan", "tax_id", "pan_card"],
}

def mask_email(val: str) -> str:
    s = str(val).strip()
    if "@" not in s:
        return s
    parts = s.split("@", 1)
    name, domain = parts[0], parts[1]
    masked_name = name[0] + "***" if len(name) > 1 else "***"
    return f"{masked_name}@{domain}"

def mask_phone(val: str) -> str:
    s = re.sub(r"[^\d]", "", str(val))
    if len(s) >= 4:
        return "*" * (len(s) - 4) + s[-4:]
    return "******"

def mask_id(val: str) -> str:
    s = str(val).strip()
    if len(s) > 4:
        return "*" * (len(s) - 4) + s[-4:]
    return "****"

def mask_value(val: Any, pii_type: str) -> str:
    if val is None or str(val).strip() == "":
        return ""
    s = str(val).strip()
    if pii_type == "email":
        return mask_email(s)
    elif pii_type == "phone":
        return mask_phone(s)
    else:
        return mask_id(s)

def detect_pii(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Vectorized scan across text/string columns to detect PII.
    Returns findings list and summary logs.
    """
    findings = []
    logs = []

    for col in df.columns:
        series = df[col].astype(str).str.strip()
        non_empty = series[~series.isin(["", "nan", "None", "null", "Unknown"])]
        if len(non_empty) < 2:
            continue

        sample_size = min(len(non_empty), 2000)
        sample = non_empty.iloc[:sample_size]

        col_lower = col.lower()
        best_type = None
        best_rate = 0.0

        for pii_type, regex in PATTERNS.items():
            matches = sample.apply(lambda x: bool(regex.match(x)))
            rate = float(matches.sum() / sample_size)

            # Boost with column hint
            if any(hint in col_lower for hint in COLUMN_HINTS.get(pii_type, [])):
                if rate > 0.15:
                    rate = min(1.0, rate + 0.35)

            if rate >= 0.40 and rate > best_rate:
                best_rate = rate
                best_type = pii_type

        if best_type and best_rate >= 0.40:
            pct = round(best_rate * 100, 1)
            first_val = str(sample.iloc[0])
            sample_masked = mask_value(first_val, best_type)
            findings.append({
                "column_name": col,
                "pii_type": best_type,
                "match_percent": pct,
                "sample_masked": sample_masked
            })
            logs.append(f"PII detected: {best_type.upper()} in column '{col}' ({pct}% match, sample: {sample_masked})")

    return {
        "findings": findings,
        "logs": logs,
        "total_pii": len(findings)
    }

def mask_dataframe_pii(df: pd.DataFrame, findings: List[Dict[str, Any]]) -> pd.DataFrame:
    """Masks all identified PII columns for safe export."""
    masked_df = df.copy()
    for f in findings:
        col = f["column_name"]
        ptype = f["pii_type"]
        if col in masked_df.columns:
            masked_df[col] = masked_df[col].apply(lambda v: mask_value(v, ptype))
    return masked_df
