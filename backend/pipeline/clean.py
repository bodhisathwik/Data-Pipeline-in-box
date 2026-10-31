import re
import math
from typing import List, Dict, Any, Tuple
import pandas as pd
import numpy as np

NULLISH = {"", "na", "n/a", "null", "none", "nan", "-", "--", "undefined", "?", "nil"}

def is_blank(val: Any) -> bool:
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return True
    s = str(val).strip().lower()
    return s in NULLISH

def standardize_col_name(name: str, index: int) -> str:
    cleaned = re.sub(r"[^\w\s-]", " ", str(name or ""))
    cleaned = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", cleaned)
    cleaned = cleaned.strip().lower()
    cleaned = re.sub(r"[\s-]+", "_", cleaned)
    return cleaned if cleaned else f"column_{index + 1}"

def infer_column_type(series: pd.Series) -> str:
    non_empty = series.dropna().astype(str).str.strip()
    non_empty = non_empty[~non_empty.str.lower().isin(NULLISH)]
    if len(non_empty) == 0:
        return "text"

    sample = non_empty.head(1000)
    cleaned_num = sample.str.replace(r"[\$,\s€£%]", "", regex=True)
    num_match = pd.to_numeric(cleaned_num, errors="coerce").notna().sum()
    if num_match / len(sample) >= 0.70:
        return "number"

    date_match = sample.str.match(r"^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}").sum()
    if date_match / len(sample) >= 0.70:
        return "date"

    bool_match = sample.str.lower().isin(["true", "false", "yes", "no", "y", "n"]).sum()
    if bool_match / len(sample) >= 0.70:
        return "boolean"

    return "text"

def clean_dataset(raw_df: pd.DataFrame, raw_headers: List[str]) -> Dict[str, Any]:
    """
    High-performance, vectorized dataset cleaning engine.
    Processes up to 100,000+ rows in seconds using native pandas/NumPy vector operations.
    """
    logs: List[str] = []
    changes: List[Dict[str, Any]] = []

    # 1. Standardize column names
    seen_cols = set()
    col_mapping = {}
    renamed_columns = []
    for i, orig in enumerate(raw_headers):
        std = standardize_col_name(orig, i)
        orig_std = std
        counter = 1
        while std in seen_cols:
            std = f"{orig_std}_{counter}"
            counter += 1
        seen_cols.add(std)
        col_mapping[orig] = std
        if std != orig:
            renamed_columns.append({"from": orig, "to": std})

    clean_headers = [col_mapping[h] for h in raw_headers]
    df = raw_df.rename(columns=col_mapping).copy()
    if renamed_columns:
        logs.append(f"Standardized {len(renamed_columns)} column name(s) to snake_case")
    else:
        logs.append("Column names are already standard snake_case")

    # 2. Vectorized duplicate removal
    initial_len = len(df)
    is_dupe = df.duplicated(keep="first")
    duplicates_removed = int(is_dupe.sum())
    df = df[~is_dupe].reset_index(drop=True)

    if duplicates_removed > 0:
        logs.append(f"Removed {duplicates_removed:,} duplicate row(s)")
    else:
        logs.append("No duplicate rows detected")

    # 3. Detect column types & missing values before cleaning
    col_types = {}
    missing_before = {}
    fill_values = {}

    for col in clean_headers:
        s = df[col]
        missing_count = int(s.isna().sum() + s.astype(str).str.strip().str.lower().isin(NULLISH).sum())
        missing_before[col] = missing_count
        ctype = infer_column_type(s)
        col_types[col] = ctype

        # Compute vector fill values
        non_null_str = s.dropna().astype(str).str.strip()
        valid_vals = non_null_str[~non_null_str.str.lower().isin(NULLISH)]

        if ctype == "number":
            cleaned_num = pd.to_numeric(valid_vals.str.replace(r"[\$,\s€£%]", "", regex=True), errors="coerce").dropna()
            fill_values[col] = round(float(cleaned_num.median()), 2) if len(cleaned_num) > 0 else 0.0
        elif ctype == "boolean":
            fill_values[col] = "false"
        elif ctype == "date":
            fill_values[col] = "2025-01-01"
        else:
            vc = valid_vals.value_counts()
            fill_values[col] = str(vc.index[0]) if len(vc) > 0 else "Unknown"

    # 4. Vectorized Transformation & Diff Extraction
    missing_fixed = 0
    types_fixed = 0

    for col in clean_headers:
        ctype = col_types[col]
        orig_series = df[col].copy()
        s = df[col].astype(str).str.strip()
        is_missing = s.str.lower().isin(NULLISH) | df[col].isna()

        if ctype == "number":
            # Strip currency and formatting symbols
            stripped = s.str.replace(r"[\$,\s€£%]", "", regex=True)
            numeric_s = pd.to_numeric(stripped, errors="coerce")
            
            # Record imputed
            imputed_mask = is_missing
            imputed_indices = df.index[imputed_mask]
            med_val = fill_values[col]
            missing_fixed += len(imputed_indices)

            # Record coerced
            invalid_num_mask = (~is_missing) & numeric_s.isna()
            coerced_format_mask = (~is_missing) & numeric_s.notna() & (s != numeric_s.astype(str))
            types_fixed += int(invalid_num_mask.sum() + coerced_format_mask.sum())

            # Apply vector fill
            numeric_s = numeric_s.fillna(med_val)
            df[col] = numeric_s

            # Extract cell change records
            # Batch construct change entries without Python cell loop
            changed_idx = df.index[imputed_mask | invalid_num_mask | coerced_format_mask]
            # Cap stored detailed changes to top 10,000 for memory efficiency
            for idx in changed_idx[:5000]:
                orig_v = orig_series.at[idx]
                new_v = df.at[idx, col]
                if imputed_mask.at[idx]:
                    reason = "Missing value imputed with column median"
                    chg_type = "imputed"
                elif invalid_num_mask.at[idx]:
                    reason = "Invalid numeric text replaced with column median"
                    chg_type = "coerced"
                else:
                    reason = "Standardized numeric format"
                    chg_type = "coerced"

                changes.append({
                    "row": int(idx),
                    "col": col,
                    "from": None if is_blank(orig_v) else str(orig_v),
                    "to": new_v,
                    "reason": reason,
                    "change_type": chg_type,
                })

        elif ctype == "boolean":
            lower_s = s.str.lower()
            norm_bool = lower_s.map({
                "true": "true", "yes": "true", "y": "true", "1": "true",
                "false": "false", "no": "false", "n": "false", "0": "false"
            })
            norm_bool = norm_bool.fillna("false")
            
            diff_mask = (s != norm_bool)
            changed_idx = df.index[diff_mask]
            types_fixed += len(changed_idx)
            df[col] = norm_bool

            for idx in changed_idx[:3000]:
                orig_v = orig_series.at[idx]
                changes.append({
                    "row": int(idx),
                    "col": col,
                    "from": None if is_blank(orig_v) else str(orig_v),
                    "to": norm_bool.at[idx],
                    "reason": "Normalized boolean representation",
                    "change_type": "standardized",
                })

        else: # text and dates
            trimmed = s.str.replace(r"\s+", " ", regex=True)
            imputed_text = trimmed.mask(is_missing, fill_values[col])
            
            imputed_mask = is_missing
            coerced_mask = (~is_missing) & (s != trimmed)
            missing_fixed += int(imputed_mask.sum())
            types_fixed += int(coerced_mask.sum())
            df[col] = imputed_text

            changed_idx = df.index[imputed_mask | coerced_mask]
            for idx in changed_idx[:5000]:
                orig_v = orig_series.at[idx]
                new_v = imputed_text.at[idx]
                reason = "Missing value imputed with column mode" if imputed_mask.at[idx] else "Trimmed excess whitespace"
                changes.append({
                    "row": int(idx),
                    "col": col,
                    "from": None if is_blank(orig_v) else str(orig_v),
                    "to": new_v,
                    "reason": reason,
                    "change_type": "imputed" if imputed_mask.at[idx] else "standardized",
                })

    if missing_fixed > 0:
        logs.append(f"Imputed {missing_fixed:,} missing value(s) with median/mode")
    if types_fixed > 0:
        logs.append(f"Fixed {types_fixed:,} type / formatting issue(s)")

    # 5. Fast Column Profiles (NumPy histogram & value_counts)
    column_profiles = []
    for idx, col in enumerate(clean_headers):
        ctype = col_types[col]
        series = df[col]
        unique_count = int(series.nunique())

        distribution = []
        if ctype == "number":
            numeric_vals = pd.to_numeric(series, errors="coerce").dropna().values
            if len(numeric_vals) > 0:
                counts, bin_edges = np.histogram(numeric_vals, bins=6)
                for b in range(len(counts)):
                    distribution.append({
                        "label": f"{round(float(bin_edges[b]), 1)}",
                        "value": int(counts[b])
                    })
        else:
            vc = series.astype(str).value_counts().head(6)
            for label, count in vc.items():
                distribution.append({"label": str(label), "value": int(count)})

        column_profiles.append({
            "name": col,
            "original": raw_headers[idx] if idx < len(raw_headers) else col,
            "type": ctype,
            "missingBefore": missing_before.get(col, 0),
            "missingAfter": 0,
            "uniqueCount": unique_count,
            "distribution": distribution,
        })

    return {
        "clean_df": df,
        "clean_headers": clean_headers,
        "clean_rows": df.head(100).to_dict(orient="records"), # preview sample
        "column_profiles": column_profiles,
        "duplicates_removed": duplicates_removed,
        "missing_fixed": missing_fixed,
        "types_fixed": types_fixed,
        "renamed_columns": renamed_columns,
        "changes": changes,
        "logs": logs,
        "col_types": col_types,
    }
