from typing import Dict, Any, List
import pandas as pd
import numpy as np

def detect_outliers(df: pd.DataFrame, numeric_columns: List[str]) -> Dict[str, Any]:
    """
    Performs IQR detection on numeric columns:
      lower = Q1 - 1.5 * IQR
      upper = Q3 + 1.5 * IQR
    Returns outlier details without modifying values.
    """
    outlier_records = []
    outlier_logs = []
    column_outlier_counts = {}

    for col in numeric_columns:
        if col not in df.columns:
            continue

        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 8:
            column_outlier_counts[col] = 0
            continue

        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        iqr = q3 - q1

        if iqr == 0:
            column_outlier_counts[col] = 0
            continue

        lower_bound = round(float(q1 - 1.5 * iqr), 2)
        upper_bound = round(float(q3 + 1.5 * iqr), 2)

        is_outlier = (series < lower_bound) | (series > upper_bound)
        outlier_indices = series.index[is_outlier]
        count = len(outlier_indices)
        column_outlier_counts[col] = count

        if count > 0:
            outlier_logs.append(
                f"Flagged {count} outlier(s) in column '{col}' (bounds {lower_bound:,.2f} to {upper_bound:,.2f})"
            )
            for idx in outlier_indices:
                val = series.at[idx]
                rule_desc = f"IQR bounds [{lower_bound}, {upper_bound}]"
                if val > upper_bound:
                    reason = f"{val:,.2f} is above the upper bound of {upper_bound:,.2f}"
                else:
                    reason = f"{val:,.2f} is below the lower bound of {lower_bound:,.2f}"

                outlier_records.append({
                    "row_index": int(idx),
                    "column_name": col,
                    "original_value": str(val),
                    "new_value": str(val),
                    "change_type": "outlier",
                    "rule_applied": reason,
                })

    return {
        "outlier_records": outlier_records,
        "outlier_logs": outlier_logs,
        "logs": outlier_logs,
        "column_outlier_counts": column_outlier_counts,
        "total_outliers": len(outlier_records)
    }
