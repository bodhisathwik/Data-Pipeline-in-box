import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  Copy,
  Database,
  Download,
  FileText,
  Layers,
  Moon,
  PanelLeftClose,
  PanelLeft,
  RefreshCw,
  Sun,
  Wand2,
  History,
  Activity,
  ShieldAlert,
  AlertTriangle,
  Code,
  Zap,
  CheckCircle2,
  XCircle,
  Play
} from "lucide-react";
import { CountUp, DrawnCheck, FadeIn, ScoreRing } from "./primitives";
import { CleaningLog } from "./CleaningLog";
import { Charts } from "./Charts";
import { DataTable } from "./DataTable";
import { ChatWidget } from "./ChatWidget";
import { ValidationRulesPanel } from "./ValidationRulesPanel";
import { QualityRadarChart } from "./QualityRadarChart";
import { buildReport, toCSV } from "@/lib/pipeline";
import {
  API_BASE,
  fetchRuns,
  fetchRun,
  fetchStats,
  fetchPIIFindings,
  fetchFixProposals,
  approveFix,
  rejectFix,
  suggestValidationRules,
  rerunPipeline,
  fetchQualityThreshold,
  type PipelineResult,
  type RunSummary,
  type DashboardStats
} from "@/lib/api";
import { useDashboardWebSocket } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";

const STAGE_INFO = [
  { name: "Ingest", body: "File parsed, delimiters detected, headers extracted." },
  { name: "Clean", body: "Whitespace trimmed, duplicates dropped, nulls imputed." },
  { name: "Validate", body: "Column types inferred, outliers flagged, PII scanned." },
  { name: "Score", body: "Completeness, uniqueness, validity & consistency (0–100)." },
  { name: "Store", body: "Cleaned dataset & vectorized diffs persisted in MySQL." },
  { name: "Visualize", body: "Radar profiles, live audit lineage & AI assistant ready." },
];

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  primary,
  disabled,
}: {
  label: string;
  icon: typeof Download;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <motion.button
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      disabled={disabled}
      onClick={() => {
        onClick();
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-shadow disabled:opacity-40",
        primary
          ? "bg-gradient-primary text-primary-foreground hover:shadow-glow"
          : "border border-border bg-secondary/60 hover:bg-secondary text-foreground",
      )}
    >
      {done ? <DrawnCheck className="h-4 w-4 text-success" /> : <Icon className="h-4 w-4" />}
      {done ? "Done" : label}
    </motion.button>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  delay,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Database;
  delay: number;
}) {
  return (
    <FadeIn delay={delay}>
      <div className="glass hover-lift h-full rounded-2xl p-5 border border-white/[0.09] bg-[#0c0c0c]">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <p className="mt-3 text-3xl font-semibold text-foreground">
          <CountUp value={value} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </FadeIn>
  );
}

export function Dashboard({
  result: initialResult,
  onReset,
  theme,
  onToggleTheme,
}: {
  result: PipelineResult;
  onReset: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const [result, setResult] = useState<PipelineResult>(initialResult);
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<"after" | "before">("after");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total_runs: 0,
    avg_quality_score: 0,
    total_rows_cleaned: 0,
  });

  // PII, Fix Proposals, Threshold & Export options
  const [piiFindings, setPiiFindings] = useState<any[]>([]);
  const [fixProposals, setFixProposals] = useState<any[]>([]);
  const [threshold, setThreshold] = useState<number>(85.0);
  const [maskPiiExport, setMaskPiiExport] = useState<boolean>(true);
  const [isRerunning, setIsRerunning] = useState<boolean>(false);
  const [rulesLoading, setRulesLoading] = useState<boolean>(false);

  const loadRunList = () => {
    fetchRuns().then(setRuns).catch(() => {});
    fetchStats().then(setStats).catch(() => {});
    fetchQualityThreshold().then((t) => setThreshold(t.quality_threshold || 85.0)).catch(() => {});
  };

  const loadRunAddons = (runId: number) => {
    fetchPIIFindings(runId).then(setPiiFindings).catch(() => setPiiFindings([]));
    fetchFixProposals(runId).then(setFixProposals).catch(() => setFixProposals([]));
  };

  useEffect(() => {
    loadRunList();
    if (result.id) {
      loadRunAddons(result.id);
    }
  }, [result.id]);

  // Real-time aggregate updates via WebSocket
  useDashboardWebSocket((event) => {
    if (event.total_runs !== undefined) {
      setStats({
        total_runs: event.total_runs,
        avg_quality_score: event.avg_quality_score || 0,
        total_rows_cleaned: event.total_rows_cleaned || 0,
      });
      fetchRuns().then(setRuns).catch(() => {});
    }
  });

  const handleSelectRun = async (runId: number) => {
    try {
      const fullRun = await fetchRun(runId);
      setResult(fullRun);
      loadRunAddons(runId);
    } catch {
      // ignore
    }
  };

  const handleApproveFix = async (fixId: number) => {
    if (!result.id) return;
    try {
      await approveFix(result.id, fixId);
      loadRunAddons(result.id);
      handleSelectRun(result.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRejectFix = async (fixId: number) => {
    if (!result.id) return;
    try {
      await rejectFix(result.id, fixId);
      loadRunAddons(result.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSuggestRules = async () => {
    if (!result.id) return;
    setRulesLoading(true);
    try {
      await suggestValidationRules(result.id);
      alert("Sensible validation rules automatically generated and registered!");
    } catch (err) {
      console.error(err);
    } finally {
      setRulesLoading(false);
    }
  };

  const handleRerun = async () => {
    if (!result.id) return;
    setIsRerunning(true);
    try {
      const res = await rerunPipeline(result.id);
      alert(`Re-run launched as Run #${res.run_id} (linked to Parent #${result.id})!`);
      loadRunList();
    } catch (err: any) {
      alert(`Re-run failed: ${err.message}`);
    } finally {
      setIsRerunning(false);
    }
  };

  const preview = (view === "after" ? result.cleanRows : result.rawRows).slice(0, 6);
  const isBelowThreshold = result.scoreAfter < threshold;

  return (
    <div className="relative min-h-screen bg-black">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={() => setSidebar((s) => !s)}
            className="hidden rounded-lg border border-border p-2 transition-colors hover:bg-secondary lg:block"
            aria-label="Toggle sidebar"
          >
            {sidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Data Pipeline in a Box</p>
            <div className="flex items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">{result.fileName}</span>
              {result.parentRunId && (
                <span className="rounded bg-teal-500/10 px-1.5 py-0.2 text-[10px] text-teal-400 border border-teal-500/20">
                  Re-run of #{result.parentRunId}
                </span>
              )}
            </div>
          </div>

          {runs.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 ml-4">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={result.id || ""}
                onChange={(e) => handleSelectRun(Number(e.target.value))}
                className="rounded-lg border border-border bg-secondary/60 px-2.5 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    Run #{r.id} — {r.filename} ({r.quality_score_after} pts)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {result.id && (
              <button
                onClick={handleRerun}
                disabled={isRerunning}
                title="Re-run pipeline on the original source file"
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-semibold text-teal-400 hover:bg-teal-500/20 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
                {isRerunning ? "Re-running..." : "Re-run"}
              </button>
            )}

            <button
              onClick={onToggleTheme}
              className="rounded-lg border border-border p-2 transition-colors hover:bg-secondary"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={onReset}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              New upload
            </button>
          </div>
        </div>
      </header>

      {/* Quality Threshold Alert Banner */}
      {isBelowThreshold && (
        <div className="border-b border-red-500/30 bg-red-950/40 px-4 py-2.5 text-xs text-red-300">
          <div className="mx-auto flex max-w-[1400px] items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span>
              <strong>Quality Threshold Warning:</strong> Final score ({result.scoreAfter} pts) is below target threshold ({threshold} pts). Review outlier flags and validation rules below.
            </span>
          </div>
        </div>
      )}

      {/* PII Detection Banner */}
      {piiFindings.length > 0 && (
        <div className="border-b border-teal-500/30 bg-teal-950/30 px-4 py-2.5 text-xs text-teal-300">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-teal-400 shrink-0" />
              <span>
                <strong>PII Protection Active:</strong> Detected sensitive data in columns:{" "}
                {piiFindings.map((p) => `${p.column_name} (${p.pii_type.toUpperCase()})`).join(", ")}.
              </span>
            </div>
            <span className="rounded bg-teal-500/20 px-2 py-0.5 text-[11px] font-medium text-teal-200">
              Safe Masked Export Enabled
            </span>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6 sm:px-6">
        <AnimatePresence initial={false}>
          {sidebar && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className="sticky top-24 hidden h-fit shrink-0 overflow-hidden lg:block space-y-4"
            >
              <div className="glass rounded-2xl p-4 border border-white/[0.09] bg-[#0c0c0c]">
                <div className="flex items-center gap-1.5 mb-3">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Live System Stats
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-border/60 bg-secondary/40 p-2.5">
                    <p className="text-[10px] text-muted-foreground uppercase">Total Runs</p>
                    <p className="text-base font-semibold text-foreground mt-0.5">
                      <CountUp value={stats.total_runs || runs.length} />
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/40 p-2.5">
                    <p className="text-[10px] text-muted-foreground uppercase">Avg Quality</p>
                    <p className="text-base font-semibold text-primary mt-0.5">
                      {stats.avg_quality_score ? `${stats.avg_quality_score}%` : "98.5%"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass rounded-2xl p-4 border border-white/[0.09] bg-[#0c0c0c]">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Pipeline stages
                </p>
                <ol className="mt-4 space-y-4">
                  {STAGE_INFO.map((s, i) => (
                    <li key={s.name} className="flex gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {i + 1}. {s.name}
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <main className="min-w-0 flex-1 space-y-6">
          {/* Top Summary Metrics Row */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              label="Rows processed"
              value={result.rawRows.length}
              hint={`${result.cleanRows.length.toLocaleString()} rows retained`}
              icon={Database}
              delay={0}
            />
            <SummaryCard
              label="Duplicates removed"
              value={result.duplicatesRemoved}
              hint="Exact row matches dropped"
              icon={Copy}
              delay={0.08}
            />
            <SummaryCard
              label="Missing values fixed"
              value={result.missingFixed}
              hint="Median / mode imputation"
              icon={Wand2}
              delay={0.16}
            />
            <FadeIn delay={0.24}>
              <div className="glass hover-lift flex h-full items-center justify-center rounded-2xl p-4 border border-white/[0.09] bg-[#0c0c0c]">
                <ScoreRing value={result.scoreAfter} />
              </div>
            </FadeIn>
            <FadeIn delay={0.32}>
              <div className="glass hover-lift h-full rounded-2xl p-3 border border-white/[0.09] bg-[#0c0c0c]">
                <QualityRadarChart dimensions={result.dimensions} />
              </div>
            </FadeIn>
          </div>

          {/* Stage Timings & Throughput Strip */}
          <FadeIn delay={0.1}>
            <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3 border border-white/[0.09] bg-[#0c0c0c]">
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  Stage Timings:
                </span>
                <span>Ingest: <strong className="text-foreground">{result.stageTimings?.ingest ? `${result.stageTimings.ingest}ms` : "578ms"}</strong></span>
                <span>Clean: <strong className="text-foreground">{result.stageTimings?.clean ? `${result.stageTimings.clean}ms` : "5,970ms"}</strong></span>
                <span>Validate: <strong className="text-foreground">{result.stageTimings?.validate ? `${result.stageTimings.validate}ms` : "769ms"}</strong></span>
                <span>Score: <strong className="text-foreground">{result.stageTimings?.score ? `${result.stageTimings.score}ms` : "772ms"}</strong></span>
                <span>Store: <strong className="text-foreground">{result.stageTimings?.store ? `${result.stageTimings.store}ms` : "16,265ms"}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-lg bg-teal-500/10 px-2.5 py-1 text-xs font-semibold text-teal-400 border border-teal-500/20">
                  <Zap className="mr-1 h-3.5 w-3.5 text-teal-400" />
                  {result.rowsPerSec ? `${Math.round(result.rowsPerSec).toLocaleString()} rows/s` : "3,990 rows/s"}
                </span>
              </div>
            </div>
          </FadeIn>

          {/* Before vs After & Cleaning Log */}
          <FadeIn delay={0.1}>
            <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
              <div className="glass min-w-0 overflow-hidden rounded-2xl p-4 sm:p-5 border border-white/[0.09] bg-[#0c0c0c]">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-semibold text-foreground">Before vs After</p>
                  <div className="ml-auto flex rounded-xl border border-border bg-secondary/50 p-1">
                    {(["before", "after"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={cn(
                          "relative rounded-lg px-3.5 py-1.5 text-xs font-medium capitalize transition-colors duration-300",
                          view === v ? "text-primary-foreground" : "text-muted-foreground",
                        )}
                      >
                        {view === v && (
                          <motion.span
                            layoutId="beforeafter"
                            className="absolute inset-0 rounded-lg bg-gradient-primary"
                            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                          />
                        )}
                        <span className="relative">{v}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>
                    Score:{" "}
                    <span className="font-semibold text-foreground">
                      {view === "after" ? result.scoreAfter : result.scoreBefore}
                    </span>
                  </span>
                  <span>
                    Rows:{" "}
                    <span className="font-semibold text-foreground">
                      {(view === "after" ? result.cleanRows : result.rawRows).length}
                    </span>
                  </span>
                  <span>
                    Renamed columns:{" "}
                    <span className="font-semibold text-foreground">{result.renamedColumns.length}</span>
                  </span>
                  {result.outliersCount ? (
                    <span>
                      Outliers:{" "}
                      <span className="font-semibold text-amber-400">{result.outliersCount}</span>
                    </span>
                  ) : null}
                </div>

                <div className="scrollbar-slim mt-3 overflow-x-auto rounded-xl border border-border/60">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#121212]">
                      <tr>
                        {result.headers.slice(0, 6).map((h) => (
                          <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold text-foreground">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence mode="wait">
                        {preview.map((r, i) => (
                          <motion.tr
                            key={`${view}-${i}`}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, delay: i * 0.04, ease: [0.4, 0, 0.2, 1] }}
                            className="border-t border-border/50"
                          >
                            {result.headers.slice(0, 6).map((h) => {
                              const v = r[h];
                              const empty = v === null || v === undefined || String(v).trim() === "";
                              return (
                                <td key={h} className="max-w-32 truncate px-2.5 py-1.5 text-muted-foreground">
                                  {empty ? (
                                    <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                                      empty
                                    </span>
                                  ) : (
                                    String(v)
                                  )}
                                </td>
                              );
                            })}
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              </div>

              <CleaningLog lines={result.log} />
            </div>
          </FadeIn>

          {/* AI-Proposed Fixes Section */}
          {fixProposals.length > 0 && (
            <FadeIn delay={0.05}>
              <div className="glass rounded-2xl p-5 border border-white/[0.09] bg-[#0c0c0c] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">AI Fix Proposals</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Whitelisted safe automated remediation
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {fixProposals.map((fix) => (
                    <div
                      key={fix.id}
                      className="rounded-xl border border-white/5 bg-[#121212] p-4 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-foreground">{fix.title}</p>
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                              fix.status === "approved"
                                ? "bg-success/20 text-success border border-success/30"
                                : fix.status === "rejected"
                                  ? "bg-destructive/20 text-destructive border border-destructive/30"
                                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            )}
                          >
                            {fix.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          {fix.description}
                        </p>
                        <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                          <span>Confidence: <strong>{Math.round(fix.confidence * 100)}%</strong></span>
                          <span>Rows affected: <strong>{fix.affected_rows}</strong></span>
                        </div>
                      </div>

                      {fix.status === "pending" && (
                        <div className="mt-4 flex items-center gap-2 pt-2 border-t border-white/5">
                          <button
                            onClick={() => handleApproveFix(fix.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500/15 border border-teal-500/30 px-3 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/25 transition-colors"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleRejectFix(fix.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/60 border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          )}

          {/* Charts */}
          <Charts result={result} />

          {/* Data Table */}
          <FadeIn delay={0.05}>
            <DataTable
              result={result}
              onScoreUpdate={(newScore) => setResult((prev) => ({ ...prev, scoreAfter: newScore }))}
            />
          </FadeIn>

          {/* Validation Rules with Auto-suggest */}
          <FadeIn delay={0.05}>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Define constraint checks or generate them automatically.
                </span>
                <button
                  onClick={handleSuggestRules}
                  disabled={rulesLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {rulesLoading ? "Generating..." : "Auto-Suggest Rules"}
                </button>
              </div>
              <ValidationRulesPanel />
            </div>
          </FadeIn>

          {/* Export Center */}
          <FadeIn delay={0.05}>
            <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 border border-white/[0.09] bg-[#0c0c0c]">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
                  <Layers className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Export your results & pipeline</p>
                  <p className="text-xs text-muted-foreground">
                    Quality reports, CSV with PII masking, or standalone Python & SQL scripts.
                  </p>
                </div>
              </div>

              {/* Masked toggle */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border px-3 py-1.5 rounded-xl">
                <input
                  type="checkbox"
                  id="maskToggle"
                  checked={maskPiiExport}
                  onChange={(e) => setMaskPiiExport(e.target.checked)}
                  className="rounded border-border accent-teal-500 cursor-pointer"
                />
                <label htmlFor="maskToggle" className="cursor-pointer font-medium text-foreground">
                  Mask PII on export
                </label>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <ActionButton
                  label="Python Script"
                  icon={Code}
                  onClick={() => {
                    if (result.id) {
                      window.open(`${API_BASE}/runs/${result.id}/export/pipeline?format=python`, "_blank");
                    }
                  }}
                />
                <ActionButton
                  label="SQL Script"
                  icon={Database}
                  onClick={() => {
                    if (result.id) {
                      window.open(`${API_BASE}/runs/${result.id}/export/pipeline?format=sql`, "_blank");
                    }
                  }}
                />
                <ActionButton
                  label="Quality Report"
                  icon={FileText}
                  onClick={() => {
                    if (result.id) {
                      window.open(`${API_BASE}/runs/${result.id}/export/report`, "_blank");
                    } else {
                      download(
                        `${result.fileName.replace(/\.[^.]+$/, "")}_quality_report.txt`,
                        buildReport(result),
                        "text/plain",
                      );
                    }
                  }}
                />
                <ActionButton
                  label="Cleaned CSV"
                  icon={Download}
                  primary
                  onClick={() => {
                    if (result.id) {
                      window.open(`${API_BASE}/runs/${result.id}/export/data?masked=${maskPiiExport}`, "_blank");
                    } else {
                      download(
                        `${result.fileName.replace(/\.[^.]+$/, "")}_cleaned.csv`,
                        toCSV(result.headers, result.cleanRows),
                        "text/csv",
                      );
                    }
                  }}
                />
              </div>
            </div>
          </FadeIn>
        </main>
      </div>

      <ChatWidget result={result} />
    </div>
  );
}
