import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from backend.database import engine, Base

def run_migrations():
    """Safely adds missing columns and creates new tables without losing data."""
    print("Running safe database migrations...")
    # 1. Create any brand new tables
    Base.metadata.create_all(bind=engine)

    # 2. Add columns to pipeline_runs if not already present
    columns_to_add = [
        ("stage_timings", "JSON NULL"),
        ("duration_ms", "FLOAT DEFAULT 0.0"),
        ("rows_per_sec", "FLOAT DEFAULT 0.0"),
        ("outliers_count", "INT DEFAULT 0"),
        ("pii_count", "INT DEFAULT 0"),
        ("completeness_before", "FLOAT DEFAULT 0.0"),
        ("completeness_after", "FLOAT DEFAULT 0.0"),
        ("uniqueness_before", "FLOAT DEFAULT 0.0"),
        ("uniqueness_after", "FLOAT DEFAULT 0.0"),
        ("validity_before", "FLOAT DEFAULT 0.0"),
        ("validity_after", "FLOAT DEFAULT 0.0"),
        ("consistency_before", "FLOAT DEFAULT 0.0"),
        ("consistency_after", "FLOAT DEFAULT 0.0"),
        ("parent_run_id", "INT NULL"),
        ("stored_filepath", "VARCHAR(500) NULL"),
    ]

    with engine.connect() as conn:
        for col_name, col_def in columns_to_add:
            try:
                conn.execute(text(f"ALTER TABLE `pipeline_runs` ADD COLUMN `{col_name}` {col_def};"))
                conn.commit()
                print(f"Added column {col_name} to pipeline_runs.")
            except Exception as e:
                # Column likely already exists
                conn.rollback()

        # Seed default threshold setting if missing
        try:
            conn.execute(text("INSERT IGNORE INTO `system_settings` (`key`, `value`) VALUES ('quality_threshold', '80');"))
            conn.commit()
        except Exception:
            conn.rollback()

    print("Migrations completed successfully.")

if __name__ == "__main__":
    run_migrations()
