export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type ColType = "number" | "date" | "boolean" | "text";

export type CellChange = {
  row: number;
  col: string;
  from: Cell;
  to: Cell;
  reason: string;
};

export type ColumnProfile = {
  name: string;
  original: string;
  type: ColType;
  missingBefore: number;
  missingAfter: number;
  uniqueCount: number;
  distribution: { label: string; value: number }[];
};

export type PipelineResult = {
  id?: number;
  fileName: string;
  rawRows: Row[];
  rawHeaders: string[];
  cleanRows: Row[];
  headers: string[];
  columns: ColumnProfile[];
  duplicatesRemoved: number;
  missingFixed: number;
  typesFixed: number;
  outliersCount?: number;
  piiCount?: number;
  durationMs?: number;
  rowsPerSec?: number;
  stageTimings?: Record<string, number>;
  dimensions?: {
    completeness: { before: number; after: number; weight?: number };
    uniqueness: { before: number; after: number; weight?: number };
    validity: { before: number; after: number; weight?: number };
    consistency: { before: number; after: number; weight?: number };
  };
  parentRunId?: number | null;
  renamedColumns: { from: string; to: string }[];
  scoreBefore: number;
  scoreAfter: number;
  changes: CellChange[];
  log: string[];
};

export type RunSummary = {
  id: number;
  filename: string;
  status: string;
  rows_before: number;
  rows_after: number;
  duplicates_removed: number;
  nulls_fixed: number;
  quality_score_before: number;
  quality_score_after: number;
  started_at: string;
  finished_at: string;
};

export type DashboardStats = {
  total_runs: number;
  avg_quality_score: number;
  total_rows_cleaned: number;
};

export type ValidationRuleItem = {
  id: number;
  column_name: string;
  rule_type: string;
  rule_value?: string | null;
};

export async function uploadDataset(file: File): Promise<{ ok: boolean; run_id: number; status: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function fetchRun(run_id: number): Promise<PipelineResult> {
  const res = await fetch(`${API_BASE}/runs/${run_id}`);
  if (!res.ok) throw new Error(`Run #${run_id} not found`);
  const data = await res.json();

  // Fetch clean rows preview
  const dataRes = await fetch(`${API_BASE}/runs/${run_id}/data?page=0&page_size=100`);
  const tableData = dataRes.ok ? await dataRes.json() : { rows: [] };

  return {
    id: data.id,
    fileName: data.fileName,
    headers: data.headers || [],
    rawHeaders: data.rawHeaders || [],
    cleanRows: tableData.rows || [],
    rawRows: tableData.rows || [], // preview
    columns: data.columns || [],
    duplicatesRemoved: data.duplicatesRemoved || 0,
    missingFixed: data.missingFixed || 0,
    typesFixed: data.typesFixed || 0,
    outliersCount: data.outliersCount || 0,
    piiCount: data.piiCount || 0,
    durationMs: data.durationMs || 0,
    rowsPerSec: data.rowsPerSec || 0,
    stageTimings: data.stageTimings || {},
    dimensions: data.dimensions,
    parentRunId: data.parentRunId,
    renamedColumns: (data.rawHeaders || []).map((orig: string, idx: number) => ({
      from: orig,
      to: (data.headers || [])[idx] || orig,
    })).filter((c: any) => c.from !== c.to),
    scoreBefore: Math.round(data.scoreBefore || 0),
    scoreAfter: Math.round(data.scoreAfter || 0),
    changes: data.changes || [],
    log: data.log || [],
  };
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const res = await fetch(`${API_BASE}/runs`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchStats(): Promise<DashboardStats> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) return { total_runs: 0, avg_quality_score: 0, total_rows_cleaned: 0 };
  return res.json();
}

export async function fetchTableData(
  run_id: number,
  page: number = 0,
  pageSize: number = 25,
  sortCol?: string,
  sortDir: "asc" | "desc" = "asc",
  q?: string
) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    sort_dir: sortDir,
  });
  if (sortCol) params.append("sort_col", sortCol);
  if (q) params.append("q", q);

  const res = await fetch(`${API_BASE}/runs/${run_id}/data?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load table data");
  return res.json();
}

export async function fetchSuggestions(run_id: number): Promise<string[]> {
  const res = await fetch(`${API_BASE}/runs/${run_id}/suggestions`, { method: "POST" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.suggestions || [];
}

export async function askDataAI(run_id: number, question: string) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error("AI Assistant query failed");
  return res.json();
}

export async function fetchValidationRules(): Promise<ValidationRuleItem[]> {
  const res = await fetch(`${API_BASE}/validation-rules`);
  if (!res.ok) return [];
  return res.json();
}

export async function createValidationRule(rule: { column_name: string; rule_type: string; rule_value?: string }) {
  const res = await fetch(`${API_BASE}/validation-rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error("Failed to save validation rule");
  return res.json();
}

export async function deleteValidationRule(id: number) {
  const res = await fetch(`${API_BASE}/validation-rules/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete validation rule");
  return res.json();
}

export async function fetchPIIFindings(run_id: number) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/pii`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchFixProposals(run_id: number) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/fixes`);
  if (!res.ok) return [];
  return res.json();
}

export async function approveFix(run_id: number, fix_id: number) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/fixes/${fix_id}/approve`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to approve fix");
  return res.json();
}

export async function rejectFix(run_id: number, fix_id: number) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/fixes/${fix_id}/reject`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reject fix");
  return res.json();
}

export async function suggestValidationRules(run_id: number) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/suggest-rules`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to auto-suggest rules");
  return res.json();
}

export async function rerunPipeline(run_id: number) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/rerun`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to re-run pipeline");
  return res.json();
}

export async function fetchCellLineage(run_id: number, row: number, col: string) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/cells/${row}/${col}/lineage`);
  if (!res.ok) throw new Error("Failed to load cell lineage");
  return res.json();
}

export async function revertCell(run_id: number, row: number, col: string) {
  const res = await fetch(`${API_BASE}/runs/${run_id}/cells/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_index: row, column_name: col }),
  });
  if (!res.ok) throw new Error("Failed to revert cell change");
  return res.json();
}

export async function fetchQualityThreshold() {
  const res = await fetch(`${API_BASE}/settings/threshold`);
  if (!res.ok) return { quality_threshold: 85.0 };
  return res.json();
}

export async function setQualityThreshold(threshold: number) {
  const res = await fetch(`${API_BASE}/settings/threshold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threshold }),
  });
  if (!res.ok) throw new Error("Failed to set quality threshold");
  return res.json();
}
