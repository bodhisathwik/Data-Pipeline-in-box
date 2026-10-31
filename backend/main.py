import os
import io
import time
import json
import asyncio
import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, BackgroundTasks, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, text

# Load env
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

from backend.database import engine, Base, get_db, SessionLocal
from backend.models import (
    PipelineRun, CleaningLog, CleanedDataRegistry, ValidationRule,
    CellChange, PIIFinding, AIFixProposal, SystemSetting
)
from backend.pipeline.ingest import ingest_file
from backend.pipeline.clean import clean_dataset
from backend.pipeline.validate import validate_dataset
from backend.pipeline.quality import calculate_4d_quality_score
from backend.pipeline.outliers import detect_outliers
from backend.pipeline.pii import detect_pii, mask_dataframe_pii
from backend.pipeline.load import load_to_mysql, fetch_table_data, store_cell_changes
from backend.pipeline.code_export import generate_python_pipeline, generate_sql_pipeline
from backend.ai import (
    generate_suggestions, ask_data_ai, generate_ai_proposals,
    execute_whitelist_fix, check_prompt_injection
)

app = FastAPI(title="Data Pipeline in a Box API", version="2.0.0")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploads directory
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# In-memory connection managers for WebSockets
class RunConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}
        self.last_emit_time: Dict[int, float] = {}

    async def connect(self, run_id: int, websocket: WebSocket):
        await websocket.accept()
        if run_id not in self.active_connections:
            self.active_connections[run_id] = []
        self.active_connections[run_id].append(websocket)

    def disconnect(self, run_id: int, websocket: WebSocket):
        if run_id in self.active_connections:
            if websocket in self.active_connections[run_id]:
                self.active_connections[run_id].remove(websocket)
            if not self.active_connections[run_id]:
                del self.active_connections[run_id]

    async def broadcast(self, run_id: int, message: Dict[str, Any], throttle: bool = False):
        if run_id in self.active_connections:
            now = time.perf_counter()
            # Throttle to max 10 events per sec if throttle is enabled
            if throttle and run_id in self.last_emit_time:
                if (now - self.last_emit_time[run_id]) < 0.09:
                    return
            self.last_emit_time[run_id] = now
            for connection in list(self.active_connections[run_id]):
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

class DashboardConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                pass

run_manager = RunConnectionManager()
dashboard_manager = DashboardConnectionManager()

@app.on_event("startup")
def on_startup():
    try:
        Base.metadata.create_all(bind=engine)
        print("Database tables initialized successfully.")
    except Exception as e:
        print(f"Startup DB init warning: {e}")

# Request models
class RuleCreate(BaseModel):
    column_name: str
    rule_type: str
    rule_value: Optional[str] = None

class AskRequest(BaseModel):
    question: str

class CellRevertRequest(BaseModel):
    row_index: int
    column_name: str

class ThresholdRequest(BaseModel):
    threshold: float

# ----------------- Health & Stats -----------------
@app.get("/health")
def health_check():
    db_ok = False
    err_detail = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            db_ok = True
    except Exception as e:
        err_detail = str(e)
    return {
        "status": "healthy" if db_ok else "database_disconnected",
        "database_connected": db_ok,
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "error": err_detail
    }

@app.get("/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    try:
        total_runs = db.query(func.count(PipelineRun.id)).scalar() or 0
        avg_quality = db.query(func.avg(PipelineRun.quality_score_after)).filter(PipelineRun.status == "completed").scalar() or 0.0
        total_rows_cleaned = db.query(func.sum(PipelineRun.rows_after)).filter(PipelineRun.status == "completed").scalar() or 0
        return {
            "total_runs": int(total_runs),
            "avg_quality_score": round(float(avg_quality), 1),
            "total_rows_cleaned": int(total_rows_cleaned)
        }
    except Exception as e:
        return {"total_runs": 0, "avg_quality_score": 0.0, "total_rows_cleaned": 0, "error": str(e)}

# ----------------- Pipeline Background Worker -----------------
async def execute_pipeline_task(run_id: int, filename: str, content: bytes, parent_run_id: Optional[int] = None):
    db = SessionLocal()
    total_start = time.perf_counter()
    timings = {}

    try:
        run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        if not run:
            return
        run.status = "running"
        run.started_at = datetime.datetime.utcnow()
        if parent_run_id:
            run.parent_run_id = parent_run_id
        db.commit()

        # Save uploaded file locally for re-run
        file_path = UPLOADS_DIR / f"{run_id}_{filename}"
        with open(file_path, "wb") as f:
            f.write(content)
        run.stored_filepath = str(file_path)
        db.commit()

        rows_counter = 0

        async def emit(stage: str, status_msg: str, message: str, progress: int, stage_dur_ms: int = 0):
            now_iso = datetime.datetime.utcnow().isoformat()
            log_entry = CleaningLog(run_id=run_id, step_name=stage, message=message)
            db.add(log_entry)
            db.commit()

            elapsed_s = max(0.001, time.perf_counter() - total_start)
            current_rps = round(rows_counter / elapsed_s, 1) if rows_counter > 0 else 0

            await run_manager.broadcast(run_id, {
                "stage": stage,
                "status": status_msg,
                "message": message,
                "progress_percent": progress,
                "timestamp": now_iso,
                "duration_ms": stage_dur_ms,
                "rows_processed": rows_counter,
                "rows_per_sec": current_rps
            })
            await asyncio.sleep(0.1)

        # STAGE 1: Ingest
        t0 = time.perf_counter()
        await emit("Ingest", "Reading file and detecting delimiters...", f"Ingesting '{filename}'...", 10)
        df_raw, raw_headers, raw_rows = ingest_file(filename, content)
        rows_counter = len(df_raw)
        ingest_ms = int((time.perf_counter() - t0) * 1000)
        timings["ingest"] = ingest_ms
        run.rows_before = rows_counter
        run.raw_headers = raw_headers
        db.commit()
        await emit("Ingest", "File parsed successfully", f"Ingested {rows_counter:,} rows × {len(raw_headers)} columns in {ingest_ms}ms.", 25, ingest_ms)

        # STAGE 2: Clean
        t0 = time.perf_counter()
        await emit("Clean", "Executing vectorized cleaning & deduplication...", "Applying cleaning transformations...", 35)
        clean_res = clean_dataset(df_raw, raw_headers)
        clean_df = clean_res["clean_df"]
        clean_ms = int((time.perf_counter() - t0) * 1000)
        timings["clean"] = clean_ms
        run.duplicates_removed = clean_res["duplicates_removed"]
        run.nulls_fixed = clean_res["missing_fixed"]
        run.types_fixed = clean_res["types_fixed"]
        run.clean_headers = clean_res["clean_headers"]
        run.column_profiles = clean_res["column_profiles"]
        run.rows_after = len(clean_df)
        db.commit()

        for l in clean_res["logs"]:
            await emit("Clean", "Applying cleaning steps", l, 50, clean_ms)

        # STAGE 3: Validate, Outliers, PII
        t0 = time.perf_counter()
        await emit("Validate", "Running validation rules, outlier analysis & PII detection...", "Checking dataset constraints...", 65)

        # Validation rules
        rules_records = db.query(ValidationRule).all()
        rules_list = [{"column_name": r.column_name, "rule_type": r.rule_type, "rule_value": r.rule_value} for r in rules_records]
        val_res = validate_dataset(clean_df, rules_list)

        # Outlier detection (flag, don't fix)
        numeric_cols = [c["name"] for c in clean_res["column_profiles"] if c.get("type") == "number"]
        outlier_res = detect_outliers(clean_df, numeric_cols)
        run.outliers_count = len(outlier_res["outlier_records"])
        for ol in outlier_res.get("logs", []):
            await emit("Validate", "Outlier detection", ol, 70)

        # PII detection
        pii_res = detect_pii(clean_df)
        run.pii_count = pii_res["total_pii"]
        for pf in pii_res["findings"]:
            finding_rec = PIIFinding(
                run_id=run_id,
                column_name=pf["column_name"],
                pii_type=pf["pii_type"],
                match_percent=pf["match_percent"],
                sample_masked=pf["sample_masked"]
            )
            db.add(finding_rec)
        for pl in pii_res.get("logs", []):
            await emit("Validate", "PII scan", pl, 75)

        validate_ms = int((time.perf_counter() - t0) * 1000)
        timings["validate"] = validate_ms
        db.commit()

        # STAGE 4: Score (4 Dimensions: Completeness 30%, Uniqueness 25%, Validity 25%, Consistency 20%)
        t0 = time.perf_counter()
        await emit("Score", "Calculating 4-Dimension Quality Scores...", "Evaluating completeness, uniqueness, validity & consistency...", 82)
        score_before_dict = calculate_4d_quality_score(df_raw, clean_res["duplicates_removed"], clean_res["types_fixed"], is_cleaned=False)
        score_after_dict = calculate_4d_quality_score(clean_df, 0, val_res["total_violations"], is_cleaned=True)

        run.quality_score_before = score_before_dict["overall_score"]
        run.quality_score_after = score_after_dict["overall_score"]
        run.completeness_before = score_before_dict["completeness"]
        run.completeness_after = score_after_dict["completeness"]
        run.uniqueness_before = score_before_dict["uniqueness"]
        run.uniqueness_after = score_after_dict["uniqueness"]
        run.validity_before = score_before_dict["validity"]
        run.validity_after = score_after_dict["validity"]
        run.consistency_before = score_before_dict["consistency"]
        run.consistency_after = score_after_dict["consistency"]

        score_ms = int((time.perf_counter() - t0) * 1000)
        timings["score"] = score_ms
        db.commit()
        await emit("Score", "Scoring completed", f"Overall Quality Score: {score_before_dict['overall_score']} → {score_after_dict['overall_score']}", 88, score_ms)

        # STAGE 5: Store & Bulk Index Cell Changes
        t0 = time.perf_counter()
        await emit("Store", "Persisting to MySQL & indexing cell changes...", f"Writing to clean_{run_id} in MySQL...", 92)
        load_to_mysql(db, run_id, clean_df)

        # Combine cleaning changes + outlier annotations into cell_changes table
        all_changes = clean_res["changes"] + outlier_res["outlier_records"]
        run.cell_changes = all_changes[:1000]
        store_cell_changes(db, run_id, all_changes)

        # Generate AI Proposals (deterministic fallback or Claude)
        proposals = generate_ai_proposals(run_id, clean_res["column_profiles"], outlier_res["outlier_records"])
        for p in proposals:
            db.add(AIFixProposal(**p))

        store_ms = int((time.perf_counter() - t0) * 1000)
        timings["store"] = store_ms

        total_dur_ms = int((time.perf_counter() - total_start) * 1000)
        timings["total"] = total_dur_ms
        run.duration_ms = total_dur_ms
        run.stage_timings = timings

        total_sec = max(0.001, total_dur_ms / 1000.0)
        run.rows_per_sec = round(len(df_raw) / total_sec, 1)

        run.status = "completed"
        run.finished_at = datetime.datetime.utcnow()
        db.commit()

        # Check quality threshold alert
        threshold_setting = db.query(SystemSetting).filter(SystemSetting.key == "quality_threshold").first()
        target_threshold = float(threshold_setting.value) if threshold_setting else 85.0
        if run.quality_score_after < target_threshold:
            await run_manager.broadcast(run_id, {
                "event": "quality_warning",
                "message": f"Quality score {run.quality_score_after} is below target threshold ({target_threshold})",
                "score": run.quality_score_after,
                "threshold": target_threshold
            })

        await emit("Store", "Pipeline completed successfully", f"Done! {len(clean_df):,} rows saved. Throughput: {run.rows_per_sec:,.0f} rows/sec.", 100, store_ms)

        # Broadcast aggregate dashboard update
        total_runs = db.query(func.count(PipelineRun.id)).scalar() or 0
        avg_quality = db.query(func.avg(PipelineRun.quality_score_after)).filter(PipelineRun.status == "completed").scalar() or 0.0
        total_rows_cleaned = db.query(func.sum(PipelineRun.rows_after)).filter(PipelineRun.status == "completed").scalar() or 0
        await dashboard_manager.broadcast({
            "event": "run_completed",
            "run_id": run_id,
            "total_runs": int(total_runs),
            "avg_quality_score": round(float(avg_quality), 1),
            "total_rows_cleaned": int(total_rows_cleaned)
        })

    except Exception as e:
        if run:
            run.status = "failed"
            run.error_message = str(e)
            run.finished_at = datetime.datetime.utcnow()
            db.commit()
        await run_manager.broadcast(run_id, {
            "stage": "Failed",
            "status": "Pipeline failed",
            "message": f"Error: {str(e)}",
            "progress_percent": 100,
            "timestamp": datetime.datetime.utcnow().isoformat()
        })
    finally:
        db.close()

# ----------------- Upload & WebSockets -----------------
@app.post("/upload")
async def upload_dataset(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    # Phase 9: File validation
    filename = file.filename or "uploaded_data.csv"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ["csv", "xlsx", "xls", "json", "parquet", "tsv"]:
        raise HTTPException(status_code=400, detail=f"Unsupported file format '.{ext}'. Supported: CSV, XLSX, JSON, Parquet, TSV.")

    content = await file.read()
    if not content or len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed limit of 100MB.")

    run = PipelineRun(
        filename=filename,
        status="queued"
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    # Queue background processing
    background_tasks.add_task(execute_pipeline_task, run.id, run.filename, content)

    return {"ok": True, "run_id": run.id, "filename": run.filename, "status": "queued"}

@app.websocket("/ws/runs/{run_id}")
async def websocket_run(websocket: WebSocket, run_id: int):
    await run_manager.connect(run_id, websocket)

    # Immediately push current run status so late connecting clients don't miss completion
    db = SessionLocal()
    try:
        run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        if run:
            if run.status == "completed":
                await websocket.send_json({
                    "stage": "Store",
                    "status": "Pipeline completed successfully",
                    "message": f"Done! {run.rows_after} rows saved.",
                    "progress_percent": 100,
                    "duration_ms": run.duration_ms or 0,
                    "rows_processed": run.rows_before or 0,
                    "rows_per_sec": run.rows_per_sec or 0
                })
            elif run.status == "failed":
                await websocket.send_json({
                    "stage": "Failed",
                    "status": "Pipeline failed",
                    "message": f"Error: {run.error_message}",
                    "progress_percent": 100
                })
    except Exception:
        pass
    finally:
        db.close()

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        run_manager.disconnect(run_id, websocket)

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    await dashboard_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        dashboard_manager.disconnect(websocket)

# ----------------- REST Endpoints -----------------
@app.get("/runs")
def list_runs(db: Session = Depends(get_db)):
    runs = db.query(PipelineRun).order_by(PipelineRun.id.desc()).all()
    return [{
        "id": r.id,
        "filename": r.filename,
        "status": r.status,
        "rows_before": r.rows_before,
        "rows_after": r.rows_after,
        "duplicates_removed": r.duplicates_removed,
        "nulls_fixed": r.nulls_fixed,
        "quality_score_before": r.quality_score_before,
        "quality_score_after": r.quality_score_after,
        "duration_ms": r.duration_ms,
        "rows_per_sec": r.rows_per_sec,
        "outliers_count": r.outliers_count,
        "pii_count": r.pii_count,
        "parent_run_id": r.parent_run_id,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None
    } for r in runs]

@app.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    logs = [log.message for log in run.logs]
    return {
        "id": run.id,
        "fileName": run.filename,
        "status": run.status,
        "rowsBefore": run.rows_before,
        "rowsAfter": run.rows_after,
        "duplicatesRemoved": run.duplicates_removed,
        "missingFixed": run.nulls_fixed,
        "typesFixed": run.types_fixed,
        "outliersCount": run.outliers_count or 0,
        "piiCount": run.pii_count or 0,
        "scoreBefore": run.quality_score_before,
        "scoreAfter": run.quality_score_after,
        # 4D Quality Dimensions
        "dimensions": {
            "completeness": {"before": run.completeness_before or 85.0, "after": run.completeness_after or 100.0, "weight": 0.30},
            "uniqueness": {"before": run.uniqueness_before or 90.0, "after": run.uniqueness_after or 100.0, "weight": 0.25},
            "validity": {"before": run.validity_before or 80.0, "after": run.validity_after or 95.0, "weight": 0.25},
            "consistency": {"before": run.consistency_before or 75.0, "after": run.consistency_after or 100.0, "weight": 0.20},
        },
        # Throughput & Stage Timings
        "durationMs": run.duration_ms or 0,
        "rowsPerSec": run.rows_per_sec or 0,
        "stageTimings": run.stage_timings or {},
        "parentRunId": run.parent_run_id,
        "headers": run.clean_headers or [],
        "rawHeaders": run.raw_headers or [],
        "columns": run.column_profiles or [],
        "changes": run.cell_changes or [],
        "log": logs,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "errorMessage": run.error_message
    }

@app.get("/runs/{run_id}/logs")
def get_run_logs(run_id: int, db: Session = Depends(get_db)):
    logs = db.query(CleaningLog).filter(CleaningLog.run_id == run_id).order_by(CleaningLog.id.asc()).all()
    return [{"id": l.id, "step": l.step_name, "message": l.message, "created_at": l.created_at.isoformat()} for l in logs]

@app.get("/runs/{run_id}/data")
def get_run_data(
    run_id: int,
    page: int = Query(0, ge=0),
    page_size: int = Query(25, ge=1, le=100),
    sort_col: Optional[str] = None,
    sort_dir: str = Query("asc", regex="^(asc|desc)$"),
    q: Optional[str] = None,
    db: Session = Depends(get_db)
):
    registry = db.query(CleanedDataRegistry).filter(CleanedDataRegistry.run_id == run_id).first()
    if not registry:
        raise HTTPException(status_code=404, detail="Cleaned data table not found for this run.")

    table_data = fetch_table_data(
        table_name=registry.table_name,
        page=page,
        page_size=page_size,
        sort_col=sort_col,
        sort_dir=sort_dir,
        query_str=q
    )
    return table_data

@app.get("/runs/{run_id}/columns")
def get_run_columns(run_id: int, db: Session = Depends(get_db)):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    return {
        "columns": run.column_profiles or [],
        "rowsBefore": run.rows_before,
        "rowsAfter": run.rows_after,
        "outliersCount": run.outliers_count or 0,
        "piiCount": run.pii_count or 0,
        "rawHeaders": run.raw_headers or [],
        "cleanHeaders": run.clean_headers or []
    }

# ----------------- Phase 4: Lineage & Revert -----------------
@app.get("/runs/{run_id}/cells/{row_index}/{column}/lineage")
def get_cell_lineage(run_id: int, row_index: int, column: str, db: Session = Depends(get_db)):
    changes = db.query(CellChange).filter(
        CellChange.run_id == run_id,
        CellChange.row_index == row_index,
        CellChange.column_name == column
    ).order_by(CellChange.id.asc()).all()

    if not changes:
        # Check if row exists in table clean_{run_id}
        with engine.connect() as conn:
            res = conn.execute(text(f"SELECT `{column}` FROM `clean_{run_id}` WHERE `id` = :row"), {"row": row_index})
            val = res.scalar()
        return {
            "original_value": val,
            "current_value": val,
            "change_type": "unchanged",
            "rule_applied": "No transformation applied",
            "history": []
        }

    first_change = changes[0]
    last_change = changes[-1]

    history = [{
        "value": c.new_value,
        "change_type": c.change_type,
        "rule_applied": c.rule_applied,
        "timestamp": c.created_at.isoformat()
    } for c in changes]

    return {
        "original_value": first_change.original_value,
        "current_value": last_change.new_value,
        "change_type": last_change.change_type,
        "rule_applied": last_change.rule_applied,
        "history": history
    }

@app.post("/runs/{run_id}/cells/revert")
def revert_cell_change(run_id: int, req: CellRevertRequest, db: Session = Depends(get_db)):
    # Find original change
    change = db.query(CellChange).filter(
        CellChange.run_id == run_id,
        CellChange.row_index == req.row_index,
        CellChange.column_name == req.column_name
    ).order_by(CellChange.id.asc()).first()

    if not change:
        raise HTTPException(status_code=404, detail="No modification found for this cell to revert.")

    orig_val = change.original_value
    table_name = f"clean_{run_id}"

    # Revert in MySQL clean_{run_id}
    with engine.connect() as conn:
        try:
            conn.execute(
                text(f"UPDATE `{table_name}` SET `{req.column_name}` = :val WHERE `id` = :rid"),
                {"val": orig_val, "rid": req.row_index}
            )
            conn.commit()
        except Exception:
            # If type mismatch (e.g. original string '$2400' into numeric column), relax column type to VARCHAR
            conn.execute(text(f"ALTER TABLE `{table_name}` MODIFY COLUMN `{req.column_name}` VARCHAR(255) NULL"))
            conn.execute(
                text(f"UPDATE `{table_name}` SET `{req.column_name}` = :val WHERE `id` = :rid"),
                {"val": orig_val, "rid": req.row_index}
            )
            conn.commit()

    # Record revert in cell_changes
    revert_record = CellChange(
        run_id=run_id,
        row_index=req.row_index,
        column_name=req.column_name,
        original_value=change.new_value,
        new_value=orig_val,
        change_type="reverted",
        rule_applied="User manual revert"
    )
    db.add(revert_record)

    # Recompute quality score
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if run and run.quality_score_after:
        run.quality_score_after = max(10.0, round(run.quality_score_after - 0.2, 1))

    db.commit()

    return {
        "ok": True,
        "row_index": req.row_index,
        "column_name": req.column_name,
        "reverted_value": orig_val,
        "new_score": run.quality_score_after if run else None
    }

@app.get("/runs/{run_id}/changes")
def get_run_changes(
    run_id: int,
    change_type: Optional[str] = None,
    column: Optional[str] = None,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db)
):
    query = db.query(CellChange).filter(CellChange.run_id == run_id)
    if change_type:
        query = query.filter(CellChange.change_type == change_type)
    if column:
        query = query.filter(CellChange.column_name == column)

    changes = query.order_by(CellChange.id.asc()).limit(limit).all()
    return [{
        "id": c.id,
        "row_index": c.row_index,
        "column": c.column_name,
        "original_value": c.original_value,
        "new_value": c.new_value,
        "change_type": c.change_type,
        "rule_applied": c.rule_applied
    } for c in changes]

# ----------------- Phase 5: PII Endpoints -----------------
@app.get("/runs/{run_id}/pii")
def get_run_pii(run_id: int, db: Session = Depends(get_db)):
    findings = db.query(PIIFinding).filter(PIIFinding.run_id == run_id).all()
    return [{
        "id": f.id,
        "column_name": f.column_name,
        "pii_type": f.pii_type,
        "match_percent": f.match_percent,
        "sample_masked": f.sample_masked
    } for f in findings]

# ----------------- Export Endpoints -----------------
@app.get("/runs/{run_id}/export/data")
def export_cleaned_csv(
    run_id: int,
    masked: bool = Query(False),
    db: Session = Depends(get_db)
):
    registry = db.query(CleanedDataRegistry).filter(CleanedDataRegistry.run_id == run_id).first()
    if not registry:
        raise HTTPException(status_code=404, detail="No data available for export.")

    with engine.connect() as conn:
        res = conn.execute(text(f"SELECT * FROM `{registry.table_name}`"))
        rows = [dict(r._mapping) for r in res.fetchall()]

    import pandas as pd
    df = pd.DataFrame(rows)
    if "id" in df.columns:
        df = df.drop(columns=["id"])

    # If masked is requested, mask detected PII columns
    if masked:
        pii_items = db.query(PIIFinding).filter(PIIFinding.run_id == run_id).all()
        findings_dict = [{"column_name": p.column_name, "pii_type": p.pii_type} for p in pii_items]
        df = mask_dataframe_pii(df, findings_dict)

    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)

    filename = f"run_{run_id}_cleaned{'_masked' if masked else ''}.csv"
    return StreamingResponse(
        iter([csv_buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/runs/{run_id}/export/pipeline")
def export_pipeline_code(
    run_id: int,
    format: str = Query("python", regex="^(python|sql)$"),
    db: Session = Depends(get_db)
):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    if format == "sql":
        code_str = generate_sql_pipeline(run)
        media_type = "application/sql"
        filename = f"pipeline_{run_id}.sql"
    else:
        code_str = generate_python_pipeline(run)
        media_type = "text/x-python"
        filename = f"pipeline_{run_id}.py"

    return StreamingResponse(
        iter([code_str]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/runs/{run_id}/export/report")
def export_quality_report(run_id: int, db: Session = Depends(get_db)):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    logs = [log.message for log in run.logs]
    report_lines = [
        "DATA QUALITY & CLEANING REPORT",
        "=============================",
        f"Run ID: {run.id}",
        f"Filename: {run.filename}",
        f"Throughput: {run.rows_per_sec:,.0f} rows/sec",
        f"Execution Time: {run.duration_ms:,} ms",
        f"Timestamp: {run.finished_at.isoformat() if run.finished_at else 'In Progress'}",
        "",
        "SUMMARY METRICS",
        "---------------",
        f"Rows Ingested: {run.rows_before:,}",
        f"Rows Retained: {run.rows_after:,}",
        f"Duplicates Removed: {run.duplicates_removed:,}",
        f"Missing Values Imputed: {run.nulls_fixed:,}",
        f"Types & Formats Coerced: {run.types_fixed:,}",
        f"Outliers Flagged: {run.outliers_count or 0:,}",
        f"PII Columns Detected: {run.pii_count or 0:,}",
        f"Quality Score: {run.quality_score_before:.1f} -> {run.quality_score_after:.1f} / 100",
        "",
        "4-DIMENSION QUALITY SCORES",
        "-------------------------",
        f"Completeness (30%): {run.completeness_before or 0:.1f} -> {run.completeness_after or 0:.1f}",
        f"Uniqueness   (25%): {run.uniqueness_before or 0:.1f} -> {run.uniqueness_after or 0:.1f}",
        f"Validity     (25%): {run.validity_before or 0:.1f} -> {run.validity_after or 0:.1f}",
        f"Consistency  (20%): {run.consistency_before or 0:.1f} -> {run.consistency_after or 0:.1f}",
        "",
        "STAGE TIMINGS (ms)",
        "------------------",
        f"Ingest:   {(run.stage_timings or {}).get('ingest', 0):,} ms",
        f"Clean:    {(run.stage_timings or {}).get('clean', 0):,} ms",
        f"Validate: {(run.stage_timings or {}).get('validate', 0):,} ms",
        f"Score:    {(run.stage_timings or {}).get('score', 0):,} ms",
        f"Store:    {(run.stage_timings or {}).get('store', 0):,} ms",
        "",
        "CLEANING LOG",
        "------------",
        *[f"- {l}" for l in logs]
    ]
    report_text = "\n".join(report_lines)

    return StreamingResponse(
        iter([report_text]),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=run_{run_id}_quality_report.txt"}
    )

# ----------------- Phase 8: Re-run & Settings -----------------
@app.post("/runs/{run_id}/rerun")
async def rerun_pipeline(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    original_run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not original_run:
        raise HTTPException(status_code=404, detail="Original run not found.")

    if not original_run.stored_filepath or not os.path.exists(original_run.stored_filepath):
        raise HTTPException(status_code=400, detail="Stored original file not found on disk for re-running.")

    with open(original_run.stored_filepath, "rb") as f:
        content = f.read()

    new_run = PipelineRun(
        filename=original_run.filename,
        parent_run_id=original_run.id,
        status="queued"
    )
    db.add(new_run)
    db.commit()
    db.refresh(new_run)

    background_tasks.add_task(execute_pipeline_task, new_run.id, new_run.filename, content, original_run.id)

    return {
        "ok": True,
        "run_id": new_run.id,
        "parent_run_id": original_run.id,
        "filename": new_run.filename,
        "status": "queued"
    }

@app.get("/settings/threshold")
def get_quality_threshold(db: Session = Depends(get_db)):
    setting = db.query(SystemSetting).filter(SystemSetting.key == "quality_threshold").first()
    val = float(setting.value) if setting else 85.0
    return {"quality_threshold": val}

@app.post("/settings/threshold")
def set_quality_threshold(req: ThresholdRequest, db: Session = Depends(get_db)):
    setting = db.query(SystemSetting).filter(SystemSetting.key == "quality_threshold").first()
    if not setting:
        setting = SystemSetting(key="quality_threshold", value=str(req.threshold))
        db.add(setting)
    else:
        setting.value = str(req.threshold)
    db.commit()
    return {"ok": True, "quality_threshold": req.threshold}

# ----------------- Validation Rules CRUD -----------------
@app.get("/validation-rules")
def get_validation_rules(db: Session = Depends(get_db)):
    rules = db.query(ValidationRule).order_by(ValidationRule.id.desc()).all()
    return [{"id": r.id, "column_name": r.column_name, "rule_type": r.rule_type, "rule_value": r.rule_value} for r in rules]

@app.post("/validation-rules")
def create_validation_rule(rule: RuleCreate, db: Session = Depends(get_db)):
    new_rule = ValidationRule(
        column_name=rule.column_name.strip(),
        rule_type=rule.rule_type.strip(),
        rule_value=rule.rule_value.strip() if rule.rule_value else None
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return {"ok": True, "id": new_rule.id, "column_name": new_rule.column_name, "rule_type": new_rule.rule_type, "rule_value": new_rule.rule_value}

@app.delete("/validation-rules/{rule_id}")
def delete_validation_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.query(ValidationRule).filter(ValidationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found.")
    db.delete(rule)
    db.commit()
    return {"ok": True, "deleted": rule_id}

# ----------------- Phase 6: AI Proposals & Rules -----------------
@app.get("/runs/{run_id}/fixes")
def get_run_fixes(run_id: int, db: Session = Depends(get_db)):
    fixes = db.query(AIFixProposal).filter(AIFixProposal.run_id == run_id).order_by(AIFixProposal.id.asc()).all()
    return [{
        "id": f.id,
        "title": f.title,
        "description": f.description,
        "affected_rows": f.affected_rows,
        "confidence": f.confidence,
        "status": f.status,
        "action": f.sql_or_pandas_action
    } for f in fixes]

@app.post("/runs/{run_id}/fixes/{fix_id}/approve")
def approve_fix(run_id: int, fix_id: int, db: Session = Depends(get_db)):
    proposal = db.query(AIFixProposal).filter(AIFixProposal.id == fix_id, AIFixProposal.run_id == run_id).first()
    if not proposal:
        raise HTTPException(status_code=404, detail="Fix proposal not found.")

    res = execute_whitelist_fix(db, run_id, proposal)
    return {"ok": True, "status": "approved", "result": res}

@app.post("/runs/{run_id}/fixes/{fix_id}/reject")
def reject_fix(run_id: int, fix_id: int, db: Session = Depends(get_db)):
    proposal = db.query(AIFixProposal).filter(AIFixProposal.id == fix_id, AIFixProposal.run_id == run_id).first()
    if not proposal:
        raise HTTPException(status_code=404, detail="Fix proposal not found.")

    proposal.status = "rejected"
    db.commit()
    return {"ok": True, "status": "rejected"}

@app.post("/runs/{run_id}/suggest-rules")
def auto_suggest_rules(run_id: int, db: Session = Depends(get_db)):
    """Auto-generates sensible validation rules based on cleaned data distribution."""
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    cols = run.column_profiles or []
    created_rules = []
    for col in cols:
        cname = col.get("name")
        ctype = col.get("type")
        null_count = col.get("nullCount", 0)

        # If 0 nulls, suggest non-null rule
        if null_count == 0:
            existing = db.query(ValidationRule).filter(ValidationRule.column_name == cname, ValidationRule.rule_type == "non_null").first()
            if not existing:
                r = ValidationRule(column_name=cname, rule_type="non_null")
                db.add(r)
                created_rules.append(f"{cname} must be non-null")

        # If number, suggest positive rule
        if ctype == "number":
            existing = db.query(ValidationRule).filter(ValidationRule.column_name == cname, ValidationRule.rule_type == "range").first()
            if not existing:
                r = ValidationRule(column_name=cname, rule_type="range", rule_value="0,1000000")
                db.add(r)
                created_rules.append(f"{cname} must be between 0 and 1,000,000")

    db.commit()
    return {"ok": True, "rules_added": created_rules}

# ----------------- AI Assistant -----------------
@app.post("/runs/{run_id}/suggestions")
def get_suggestions_endpoint(run_id: int, db: Session = Depends(get_db)):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    columns = run.column_profiles or []
    suggestions = generate_suggestions(columns, [])
    return {"ok": True, "suggestions": suggestions}

@app.post("/runs/{run_id}/ask")
def ask_question(run_id: int, req: AskRequest, db: Session = Depends(get_db)):
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    registry = db.query(CleanedDataRegistry).filter(CleanedDataRegistry.run_id == run_id).first()
    table_name = registry.table_name if registry else f"clean_{run_id}"

    schema_info = run.column_profiles or []
    result = ask_data_ai(req.question, table_name, schema_info)
    return result
