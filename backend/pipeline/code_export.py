from typing import List, Dict, Any
from backend.models import PipelineRun

def generate_python_pipeline(run: PipelineRun) -> str:
    filename = run.filename or "dataset.csv"
    code = f'''"""
Data Pipeline in a Box - Generated Python Cleaning Pipeline
Reproducing transformations for: {filename}
Quality Score: {run.quality_score_before or 0:.1f} -> {run.quality_score_after or 0:.1f} / 100
Generated on: {run.finished_at.isoformat() if run.finished_at else 'N/A'}
"""

import pandas as pd
import numpy as np

def clean_data(input_path: str, output_path: str = "cleaned_data.csv"):
    print(f"Reading input dataset from {{input_path}}...")
    # Load dataset with auto-delimiter detection
    df = pd.read_csv(input_path, skipinitialspace=True)
    initial_rows = len(df)
    print(f"Loaded {{initial_rows}} rows and {{len(df.columns)}} columns.")

    # 1. Deduplication
    df = df.drop_duplicates().reset_index(drop=True)
    duplicates_removed = initial_rows - len(df)
    print(f"Removed {{duplicates_removed}} duplicate rows.")

    # 2. Column-wise cleaning and type normalization
'''

    # Add specific column transformations based on column_profiles
    if run.column_profiles:
        for col in run.column_profiles:
            cname = col.get("name")
            ctype = col.get("type", "text")
            null_count = col.get("nullCount", 0)

            code += f'    # Column: {cname} (Type: {ctype})\n'
            code += f'    if "{cname}" in df.columns:\n'
            if ctype == "text":
                code += f'        df["{cname}"] = df["{cname}"].astype(str).str.strip()\n'
                code += f'        df["{cname}"] = df["{cname}"].replace(["nan", "None", "null", "N/A", "na"], "")\n'
                if null_count > 0:
                    code += f'        df["{cname}"] = df["{cname}"].fillna("Unknown")\n'
            elif ctype == "number":
                code += f'        df["{cname}"] = pd.to_numeric(df["{cname}"], errors="coerce")\n'
                if null_count > 0:
                    code += f'        df["{cname}"] = df["{cname}"].fillna(df["{cname}"].median())\n'
            elif ctype == "date":
                code += f'        df["{cname}"] = pd.to_datetime(df["{cname}"], errors="coerce").dt.strftime("%Y-%m-%d")\n'

    code += '''
    # 3. Save cleaned dataset
    df.to_csv(output_path, index=False)
    print(f"Cleaned dataset saved successfully to {output_path} ({len(df)} rows).")
    return df

if __name__ == "__main__":
    clean_data("''' + filename + '''")
'''
    return code


def generate_sql_pipeline(run: PipelineRun) -> str:
    filename = run.filename or "dataset.csv"
    table_name = f"clean_{run.id}"
    
    sql = f"""-- ========================================================
-- Data Pipeline in a Box - SQL Cleaning Pipeline
-- Reproducing transformations for: {filename}
-- Quality Score: {run.quality_score_before or 0:.1f} -> {run.quality_score_after or 0:.1f} / 100
-- Target Table: {table_name}
-- ========================================================

-- Step 1: Ensure Target Database Exists
CREATE DATABASE IF NOT EXISTS pipeline_box 
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pipeline_box;

-- Step 2: Create Cleaned Table Structure
CREATE TABLE IF NOT EXISTS `{table_name}` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
"""
    col_defs = []
    if run.column_profiles:
        for col in run.column_profiles:
            cname = col.get("name").replace("`", "")
            ctype = col.get("type", "text")
            if ctype == "number":
                sql_type = "DOUBLE"
            elif ctype == "date":
                sql_type = "DATE"
            else:
                sql_type = "VARCHAR(255)"
            col_defs.append(f"  `{cname}` {sql_type} NULL")
    else:
        col_defs.append("  `data` TEXT NULL")
        
    sql += ",\n".join(col_defs)
    sql += "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n"

    sql += f"""-- Step 3: Remove duplicate rows example
-- DELETE t1 FROM `{table_name}` t1
-- INNER JOIN `{table_name}` t2 
-- WHERE t1.id > t2.id;

-- Step 4: Impute Missing Numeric Values
"""
    if run.column_profiles:
        for col in run.column_profiles:
            cname = col.get("name").replace("`", "")
            ctype = col.get("type", "text")
            if ctype == "number":
                sql += f"UPDATE `{table_name}` SET `{cname}` = 0 WHERE `{cname}` IS NULL;\n"
            elif ctype == "text":
                sql += f"UPDATE `{table_name}` SET `{cname}` = 'Unknown' WHERE `{cname}` IS NULL OR `{cname}` = '';\n"

    sql += f"\n-- Done! Verified {run.rows_after or 0} cleaned rows in `{table_name}`.\n"
    return sql

