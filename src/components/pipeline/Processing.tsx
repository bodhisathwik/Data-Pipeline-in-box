import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { AnimatedBlobs, DrawnCheck } from "./primitives";
import { cn } from "@/lib/utils";
import { useRunWebSocket, type WebSocketEvent } from "@/hooks/use-websocket";
import { API_BASE } from "@/lib/api";

export const STAGES = [
  { name: "Ingest", status: "Reading file and detecting delimiters..." },
  { name: "Clean", status: "Removing duplicate rows and trimming values..." },
  { name: "Validate", status: "Inferring column types and checking schema..." },
  { name: "Score", status: "Calculating data quality score..." },
  { name: "Store", status: "Persisting cleaned dataset..." },
  { name: "Visualize", status: "Building charts and profiles..." },
];

export function Processing({
  runId,
  onDone,
  onLiveLog,
}: {
  runId?: number | null;
  onDone: () => void;
  onLiveLog?: (msg: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [livePercent, setLivePercent] = useState<number | null>(null);
  const [stageStatuses, setStageStatuses] = useState<Record<string, string>>({});
  const [stageTimings, setStageTimings] = useState<Record<string, number>>({});
  const [liveRowsPerSec, setLiveRowsPerSec] = useState<number>(0);
  const [rowsProcessed, setRowsProcessed] = useState<number>(0);

  useRunWebSocket(runId || null, (event: WebSocketEvent) => {
    if (event.message && onLiveLog) {
      onLiveLog(event.message);
    }
    if (event.rows_per_sec !== undefined) {
      setLiveRowsPerSec(event.rows_per_sec);
    }
    if (event.rows_processed !== undefined) {
      setRowsProcessed(event.rows_processed);
    }
    if (event.stage) {
      const idx = STAGES.findIndex((s) => s.name.toLowerCase() === event.stage?.toLowerCase());
      if (idx !== -1) {
        setStep(idx);
        if (event.status) {
          setStageStatuses((prev) => ({ ...prev, [event.stage!]: event.status! }));
        }
      }
      if (event.duration_ms !== undefined && event.duration_ms > 0) {
        setStageTimings((prev) => ({ ...prev, [event.stage!.toLowerCase()]: event.duration_ms! }));
      }
    }
    if (event.progress_percent !== undefined) {
      setLivePercent(event.progress_percent);
      if (event.progress_percent >= 100) {
        setStep(STAGES.length);
        setTimeout(onDone, 500);
      }
    }
  });

  // Active polling fallback in case WebSocket finishes fast or misses an event
  useEffect(() => {
    if (!runId) return;

    let isDoneCalled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/runs/${runId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.stageTimings) {
          setStageTimings(data.stageTimings);
        }
        if (data.rowsPerSec) {
          setLiveRowsPerSec(data.rowsPerSec);
        }
        if (data.rowsBefore) {
          setRowsProcessed(data.rowsBefore);
        }

        if (data.status === "completed" && !isDoneCalled) {
          isDoneCalled = true;
          setStep(STAGES.length);
          setLivePercent(100);
          clearInterval(interval);
          setTimeout(onDone, 400);
        } else if (data.status === "failed" && !isDoneCalled) {
          isDoneCalled = true;
          clearInterval(interval);
          setTimeout(onDone, 400);
        }
      } catch (e) {
        // network retry
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [runId, onDone]);

  // Simulated fallback if runId is not provided
  useEffect(() => {
    if (runId) return;
    if (step >= STAGES.length) {
      const t = setInterval(onDone, 400);
      return () => clearInterval(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), 620);
    return () => clearTimeout(t);
  }, [step, onDone, runId]);

  const progress = livePercent !== null ? livePercent : Math.min(100, (step / STAGES.length) * 100);

  return (
    <section className="relative min-h-screen overflow-hidden px-5 py-20 sm:px-8">
      <AnimatedBlobs />
      <div className="relative mx-auto max-w-3xl">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Running your pipeline
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Six stages, executed end to end.
        </p>

        <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <motion.div
            className="h-full rounded-full bg-gradient-primary"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
          />
        </div>

        <div className="glass mt-8 space-y-1 rounded-2xl p-3 sm:p-5">
          {STAGES.map((stage, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <motion.div
                key={stage.name}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-500",
                  active && "bg-secondary/70",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-500",
                    done
                      ? "border-transparent bg-success text-success-foreground"
                      : active
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {done ? (
                    <DrawnCheck />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-xs">{i + 1}</span>
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{stage.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {done ? "Completed" : stage.status}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Stage timings strip & throughput */}
        <div className="glass mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs border border-white/[0.09] bg-[#0c0c0c]">
          <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
            <span className="font-medium text-foreground">Stage Timings:</span>
            <span>Ingest: <strong className="text-foreground">{stageTimings.ingest ? `${(stageTimings.ingest / 1000).toFixed(2)}s` : "..."}</strong></span>
            <span>Clean: <strong className="text-foreground">{stageTimings.clean ? `${(stageTimings.clean / 1000).toFixed(2)}s` : "..."}</strong></span>
            <span>Validate: <strong className="text-foreground">{stageTimings.validate ? `${(stageTimings.validate / 1000).toFixed(2)}s` : "..."}</strong></span>
            <span>Score: <strong className="text-foreground">{stageTimings.score ? `${(stageTimings.score / 1000).toFixed(2)}s` : "..."}</strong></span>
            <span>Store: <strong className="text-foreground">{stageTimings.store ? `${(stageTimings.store / 1000).toFixed(2)}s` : "..."}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-teal-500/10 px-2 py-0.5 text-xs font-semibold text-teal-400 border border-teal-500/20">
              ⚡ {liveRowsPerSec > 0 ? `${Math.round(liveRowsPerSec).toLocaleString()} rows/s` : rowsProcessed > 0 ? `${rowsProcessed.toLocaleString()} rows` : "Processing..."}
            </span>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border/60 bg-card/50"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-2xl border border-border/60 bg-card/50"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
