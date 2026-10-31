import os
import sys
import datetime
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.database import SessionLocal, Base, engine
from backend.models import PipelineRun, CleaningLog, CleanedDataRegistry, ValidationRule
from backend.pipeline.ingest import ingest_file
from backend.pipeline.clean import clean_dataset
from backend.pipeline.load import load_to_mysql

def seed_database():
    print("Seeding database with sample completed runs and default validation rules...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Seed Default Validation Rules
    existing_rules = db.query(ValidationRule).count()
    if existing_rules == 0:
        rules = [
            ValidationRule(column_name="monthly_revenue", rule_type="min", rule_value="0"),
            ValidationRule(column_name="customer_name", rule_type="not_null", rule_value=""),
            ValidationRule(column_name="is_active", rule_type="regex", rule_value="^(true|false)$"),
        ]
        db.add_all(rules)
        db.commit()
        print("Inserted default validation rules.")

    # Seed 3 Completed Pipeline Runs
    sample_csv_path = Path(__file__).resolve().parent / "samples" / "messy_customers_sample.csv"
    with open(sample_csv_path, "rb") as f:
        content = f.read()

    run_titles = [
        "q3_customer_revenue_raw.csv",
        "enterprise_accounts_sync.csv",
        "monthly_churn_telemetry.csv"
    ]

    for title in run_titles:
        existing = db.query(PipelineRun).filter(PipelineRun.filename == title).first()
        if existing:
            continue

        df_raw, raw_headers, raw_rows = ingest_file(title, content)
        clean_res = clean_dataset(df_raw, raw_headers)

        run = PipelineRun(
            filename=title,
            status="completed",
            rows_before=len(df_raw),
            rows_after=len(clean_res["clean_df"]),
            duplicates_removed=clean_res["duplicates_removed"],
            nulls_fixed=clean_res["missing_fixed"],
            types_fixed=clean_res["types_fixed"],
            quality_score_before=82.5,
            quality_score_after=98.5,
            raw_headers=raw_headers,
            clean_headers=clean_res["clean_headers"],
            column_profiles=clean_res["column_profiles"],
            cell_changes=clean_res["changes"],
            started_at=datetime.datetime.utcnow() - datetime.timedelta(hours=2),
            finished_at=datetime.datetime.utcnow() - datetime.timedelta(hours=1, minutes=58)
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        # Seed logs
        logs = [
            CleaningLog(run_id=run.id, step_name="Ingest", message=f"Ingested '{title}' with {len(df_raw)} rows."),
            CleaningLog(run_id=run.id, step_name="Clean", message=f"Removed {clean_res['duplicates_removed']} duplicate rows."),
            CleaningLog(run_id=run.id, step_name="Clean", message=f"Imputed {clean_res['missing_fixed']} missing values with median/mode."),
            CleaningLog(run_id=run.id, step_name="Validate", message="Schema validated against constraints."),
            CleaningLog(run_id=run.id, step_name="Score", message="Quality score improved from 82.5 to 98.5."),
            CleaningLog(run_id=run.id, step_name="Store", message=f"Cleaned dataset saved in MySQL table clean_{run.id}.")
        ]
        db.add_all(logs)
        db.commit()

        # Load clean table in MySQL
        load_to_mysql(db, run.id, clean_res["clean_df"])
        print(f"Seeded run #{run.id}: {title}")

    db.close()
    print("Database seeding completed.")

if __name__ == "__main__":
    seed_database()
