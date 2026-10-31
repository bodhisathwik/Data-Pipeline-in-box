import re
from typing import List, Dict, Any
import pandas as pd

def validate_dataset(df: pd.DataFrame, rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Applies validation rules to the DataFrame.
    rules: list of dicts with keys: column_name, rule_type, rule_value
    """
    violations_by_rule = []
    total_violations = 0

    for rule in rules:
        col = rule.get("column_name")
        rtype = rule.get("rule_type", "").lower()
        rval = rule.get("rule_value")

        if col not in df.columns:
            continue

        series = df[col]
        violation_indices = []

        if rtype == "not_null":
            for idx, val in series.items():
                if val is None or str(val).strip() == "":
                    violation_indices.append(idx)
        elif rtype == "range":
            # expected format "min-max" or "min,max"
            try:
                parts = re.split(r"[-,]", str(rval).strip())
                min_v = float(parts[0])
                max_v = float(parts[1])
                for idx, val in series.items():
                    try:
                        v = float(val)
                        if v < min_v or v > max_v:
                            violation_indices.append(idx)
                    except (ValueError, TypeError):
                        violation_indices.append(idx)
            except Exception:
                pass
        elif rtype == "min":
            try:
                min_v = float(rval)
                for idx, val in series.items():
                    try:
                        v = float(val)
                        if v < min_v:
                            violation_indices.append(idx)
                    except (ValueError, TypeError):
                        violation_indices.append(idx)
            except Exception:
                pass
        elif rtype == "max":
            try:
                max_v = float(rval)
                for idx, val in series.items():
                    try:
                        v = float(val)
                        if v > max_v:
                            violation_indices.append(idx)
                    except (ValueError, TypeError):
                        violation_indices.append(idx)
            except Exception:
                pass
        elif rtype == "regex":
            try:
                pattern = re.compile(str(rval))
                for idx, val in series.items():
                    if not pattern.search(str(val)):
                        violation_indices.append(idx)
            except Exception:
                pass

        v_count = len(violation_indices)
        total_violations += v_count
        if v_count > 0:
            sample_vals = [str(series.iloc[i]) for i in violation_indices[:3]]
            violations_by_rule.append({
                "column": col,
                "rule_type": rtype,
                "rule_value": rval,
                "violations": v_count,
                "samples": sample_vals
            })

    return {
        "total_violations": total_violations,
        "violations_by_rule": violations_by_rule
    }
