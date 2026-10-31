import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.pipeline.ingest import ingest_file
from backend.pipeline.clean import clean_dataset
from backend.pipeline.validate import validate_dataset
from backend.pipeline.quality import calculate_quality_score

sample_path = Path(__file__).resolve().parent / "samples" / "messy_customers_sample.csv"

def run_test():
    print(f"Loading sample file: {sample_path}")
    with open(sample_path, "rb") as f:
        content = f.read()

    # Stage 1: Ingest
    df_raw, raw_headers, raw_rows = ingest_file(sample_path.name, content)
    print(f"[Stage 1: Ingest] Read {len(df_raw)} rows, {len(raw_headers)} columns.")
    print(f"Headers: {raw_headers}")

    # Stage 2: Clean
    cleaned = clean_dataset(df_raw, raw_headers)
    print(f"[Stage 2: Clean] Duplicates removed: {cleaned['duplicates_removed']}")
    print(f"Missing fixed: {cleaned['missing_fixed']}, Types fixed: {cleaned['types_fixed']}")
    print(f"Retained rows: {len(cleaned['clean_df'])}")
    for log in cleaned["logs"]:
        print(f"  -> {log}")

    # Stage 3: Validate
    rules = [
        {"column_name": "monthly_revenue", "rule_type": "min", "rule_value": "0"},
        {"column_name": "customer_name", "rule_type": "not_null", "rule_value": ""}
    ]
    val_res = validate_dataset(cleaned["clean_df"], rules)
    print(f"[Stage 3: Validate] Total violations: {val_res['total_violations']}")

    # Stage 4: Quality Score
    score_before = calculate_quality_score(
        raw_rows,
        raw_headers,
        duplicates_count=cleaned["duplicates_removed"],
        issue_count=cleaned["types_fixed"]
    )
    score_after = calculate_quality_score(
        cleaned["clean_rows"],
        cleaned["clean_headers"],
        duplicates_count=0,
        issue_count=val_res["total_violations"]
    )
    print(f"[Stage 4: Quality Score] Quality Score: {score_before} -> {score_after}")
    print("PIPELINE TEST PASSED SUCCESSFULLY.")

if __name__ == "__main__":
    run_test()
