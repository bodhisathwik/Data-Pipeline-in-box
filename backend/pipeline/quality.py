import re
from typing import List, Dict, Any, Tuple
import pandas as pd
from backend.pipeline.clean import is_blank

def compute_column_consistency(series: pd.Series) -> float:
    """Computes formatting/casing/pattern consistency ratio (0.0 to 1.0) for a column."""
    non_null = series.dropna().astype(str).str.strip()
    non_null = non_null[~non_null.isin(["", "nan", "None", "Unknown"])]
    if len(non_null) <= 1:
        return 1.0

    sample = non_null.head(1000)
    # Check casing pattern
    patterns = {
        "lower": sample.str.islower(),
        "upper": sample.str.isupper(),
        "title": sample.str.istitle(),
        "numeric": sample.str.replace(r"[.,\-]", "", regex=True).str.isnumeric(),
        "date_iso": sample.str.match(r"^\d{4}-\d{2}-\d{2}$"),
        "date_slash": sample.str.match(r"^\d{1,2}/\d{1,2}/\d{2,4}$")
    }

    best_match_ratio = 0.5
    for name, matches in patterns.items():
        ratio = float(matches.sum() / len(sample))
        if ratio > best_match_ratio:
            best_match_ratio = ratio

    return min(1.0, max(0.2, best_match_ratio))

def calculate_4d_quality_score(
    df: pd.DataFrame,
    duplicates_count: int,
    issue_count: int,
    is_cleaned: bool = False
) -> Dict[str, float]:
    """
    Computes 4 data quality dimensions:
      1. Completeness (30% weight)
      2. Uniqueness (25% weight)
      3. Validity (25% weight)
      4. Consistency (20% weight)
    Returns {completeness, uniqueness, validity, consistency, overall_score}
    """
    if len(df) == 0 or len(df.columns) == 0:
        return {
            "completeness": 0.0,
            "uniqueness": 0.0,
            "validity": 0.0,
            "consistency": 0.0,
            "overall_score": 0.0
        }

    total_cells = len(df) * len(df.columns)
    # 1. Completeness: count missing/blank cells
    missing_cells = int(df.isna().sum().sum())
    # Add nullish string count
    for col in df.columns:
        if df[col].dtype == object or str(df[col].dtype).startswith("str"):
            missing_cells += int(df[col].astype(str).str.lower().str.strip().isin(["", "na", "n/a", "null", "none", "nan", "-"]).sum())
    missing_cells = min(total_cells, missing_cells)
    completeness = round(max(0.0, (1.0 - (missing_cells / total_cells))) * 100, 1)

    # 2. Uniqueness: 1 - duplicate rows ratio
    uniqueness = round(max(0.0, (1.0 - (duplicates_count / (len(df) + duplicates_count if not is_cleaned else len(df))))) * 100, 1)

    # 3. Validity: 1 - type/schema/format issues ratio
    validity = round(max(0.0, (1.0 - (issue_count / total_cells))) * 100, 1)

    # 4. Consistency: pattern/format alignment
    if is_cleaned:
        consistency = 100.0
    else:
        col_cons = [compute_column_consistency(df[c]) for c in df.columns]
        consistency = round(float(sum(col_cons) / len(col_cons)) * 100, 1) if col_cons else 90.0

    # Weighted formula: Completeness 30%, Uniqueness 25%, Validity 25%, Consistency 20%
    overall = round(
        (completeness * 0.30) +
        (uniqueness * 0.25) +
        (validity * 0.25) +
        (consistency * 0.20),
        1
    )

    return {
        "completeness": completeness,
        "uniqueness": uniqueness,
        "validity": validity,
        "consistency": consistency,
        "overall_score": overall
    }

# Backward compatibility alias
def calculate_quality_score(
    rows: List[Dict[str, Any]],
    headers: List[str],
    duplicates_count: int,
    issue_count: int
) -> float:
    df = pd.DataFrame(rows)
    res = calculate_4d_quality_score(df, duplicates_count, issue_count)
    return res["overall_score"]
