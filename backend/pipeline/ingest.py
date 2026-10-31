import io
from typing import Tuple, List, Dict, Any
import pandas as pd

def ingest_file(filename: str, content: bytes) -> Tuple[pd.DataFrame, List[str], List[Dict[str, Any]]]:
    """
    Ingests CSV, TSV, or Excel files into a pandas DataFrame.
    Returns (raw_df, raw_headers, raw_rows_sample).
    """
    lower = filename.lower()
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content), dtype=str)
    elif lower.endswith(".tsv"):
        df = pd.read_csv(io.BytesIO(content), sep="\t", dtype=str, skip_blank_lines=True, on_bad_lines="skip")
    elif lower.endswith(".json"):
        df = pd.read_json(io.BytesIO(content), dtype=str)
    elif lower.endswith(".parquet"):
        df = pd.read_parquet(io.BytesIO(content))
    else:
        # High performance C engine with fallback
        try:
            df = pd.read_csv(io.BytesIO(content), dtype=str, skip_blank_lines=True, on_bad_lines="skip", engine="c")
        except Exception:
            df = pd.read_csv(io.BytesIO(content), dtype=str, skip_blank_lines=True, on_bad_lines="skip", sep=None, engine="python")

    # Drop rows that are completely empty
    df = df.dropna(how="all")
    # Drop columns with no header
    df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

    raw_headers = [str(c).strip() for c in df.columns]
    df.columns = raw_headers
    
    # Store sample rows for fast UI previews
    sample_rows = df.head(100).fillna("").to_dict(orient="records")

    return df, raw_headers, sample_rows
