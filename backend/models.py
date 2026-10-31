import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Float, DateTime, ForeignKey, JSON, Boolean, Index
)
from sqlalchemy.orm import relationship
from backend.database import Base

class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    filename = Column(String(255), nullable=False)
    status = Column(String(50), default="queued", nullable=False) # queued, running, completed, failed
    rows_before = Column(Integer, default=0)
    rows_after = Column(Integer, default=0)
    duplicates_removed = Column(Integer, default=0)
    nulls_fixed = Column(Integer, default=0)
    types_fixed = Column(Integer, default=0)
    outliers_count = Column(Integer, default=0)
    pii_count = Column(Integer, default=0)
    
    # 4 Quality Dimensions
    completeness_before = Column(Float, default=0.0)
    completeness_after = Column(Float, default=0.0)
    uniqueness_before = Column(Float, default=0.0)
    uniqueness_after = Column(Float, default=0.0)
    validity_before = Column(Float, default=0.0)
    validity_after = Column(Float, default=0.0)
    consistency_before = Column(Float, default=0.0)
    consistency_after = Column(Float, default=0.0)
    quality_score_before = Column(Float, default=0.0)
    quality_score_after = Column(Float, default=0.0)
    
    # Throughput & Timings
    duration_ms = Column(Float, default=0.0)
    rows_per_sec = Column(Float, default=0.0)
    stage_timings = Column(JSON, nullable=True) # {ingest_ms, clean_ms, validate_ms, score_ms, store_ms}
    
    # Lineage / Re-run
    parent_run_id = Column(Integer, ForeignKey("pipeline_runs.id", ondelete="SET NULL"), nullable=True)
    stored_filepath = Column(String(500), nullable=True)

    raw_headers = Column(JSON, nullable=True)
    clean_headers = Column(JSON, nullable=True)
    column_profiles = Column(JSON, nullable=True)
    cell_changes = Column(JSON, nullable=True) # legacy fallback, now in CellChange table
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    logs = relationship("CleaningLog", back_populates="run", cascade="all, delete-orphan")
    registry = relationship("CleanedDataRegistry", back_populates="run", uselist=False, cascade="all, delete-orphan")
    changes_rel = relationship("CellChange", back_populates="run", cascade="all, delete-orphan")
    pii_findings = relationship("PIIFinding", back_populates="run", cascade="all, delete-orphan")
    fix_proposals = relationship("AIFixProposal", back_populates="run", cascade="all, delete-orphan")

class CellChange(Base):
    __tablename__ = "cell_changes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    row_index = Column(Integer, nullable=False)
    column_name = Column(String(100), nullable=False)
    original_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    change_type = Column(String(50), default="imputed", nullable=False) # imputed, coerced, standardized, outlier, pii_masked, reverted
    rule_applied = Column(Text, nullable=True)
    is_reverted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        Index("idx_run_row_col", "run_id", "row_index", "column_name"),
    )

    run = relationship("PipelineRun", back_populates="changes_rel")

class CleaningLog(Base):
    __tablename__ = "cleaning_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    step_name = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    run = relationship("PipelineRun", back_populates="logs")

class CleanedDataRegistry(Base):
    __tablename__ = "cleaned_data_registry"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, unique=True)
    table_name = Column(String(100), nullable=False, unique=True)
    row_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    run = relationship("PipelineRun", back_populates="registry")

class ValidationRule(Base):
    __tablename__ = "validation_rules"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    column_name = Column(String(100), nullable=False)
    rule_type = Column(String(50), nullable=False) # range, regex, not_null, min, max
    rule_value = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class PIIFinding(Base):
    __tablename__ = "pii_findings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String(100), nullable=False)
    pii_type = Column(String(50), nullable=False) # email, phone, ssn, aadhaar, pan
    match_percent = Column(Float, default=0.0)
    sample_masked = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    run = relationship("PipelineRun", back_populates="pii_findings")

class AIFixProposal(Base):
    __tablename__ = "ai_fix_proposals"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    affected_rows = Column(Integer, default=0)
    confidence = Column(Float, default=0.90)
    sql_or_pandas_action = Column(Text, nullable=True)
    status = Column(String(30), default="pending", nullable=False) # pending, approved, rejected
    
    # Optional legacy columns
    column_name = Column(String(100), nullable=True)
    issue = Column(String(255), nullable=True)
    proposed_fix = Column(Text, nullable=True)
    fix_type = Column(String(50), nullable=True)
    projected_delta = Column(Float, default=0.0)
    actual_delta = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    run = relationship("PipelineRun", back_populates="fix_proposals")

class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(50), primary_key=True)
    value = Column(String(255), nullable=False)
