import { useRef, useState } from "react";
import { motion } from "motion/react";
import { UploadCloud, FileSpreadsheet, Sparkles, ShieldCheck, Gauge } from "lucide-react";
import { AnimatedBlobs, FadeIn } from "./primitives";
import { cn } from "@/lib/utils";

const STAGES = ["Ingest", "Clean", "Validate", "Score", "Store", "Visualize"];

export function Landing({
  onFile,
  onSample,
}: {
  onFile: (file: File) => void;
  onSample: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="relative min-h-screen overflow-hidden px-5 pb-24 pt-16 sm:px-8">
      <AnimatedBlobs />
      <div className="relative mx-auto max-w-4xl text-center">
        <FadeIn>
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI-powered data pipeline — ingest to insight in seconds
          </span>
        </FadeIn>

        <FadeIn delay={0.08}>
          <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Turn Messy Data Into <span className="text-gradient">Clean Insights</span> — Instantly
          </h1>
        </FadeIn>

        <FadeIn delay={0.16}>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
            Drop a CSV or Excel file and watch a full pipeline run live — deduplicated, validated,
            scored and visualized, with an AI analyst standing by.
          </p>
        </FadeIn>

        <FadeIn delay={0.24}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) onFile(file);
            }}
            className={cn(
              "group glass mx-auto mt-12 flex cursor-pointer flex-col items-center gap-4 rounded-3xl px-6 py-14 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] sm:px-16",
              dragging ? "shadow-glow scale-[1.02]" : "hover:shadow-glow hover:scale-[1.01]",
            )}
          >
            <motion.div
              animate={{ scale: dragging ? [1, 1.08, 1] : [1, 1.05, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground"
            >
              <UploadCloud className="h-7 w-7" />
            </motion.div>
            <p className="text-lg font-medium">
              {dragging ? "Release to start the pipeline" : "Drag & drop your dataset"}
            </p>
            <p className="text-sm text-muted-foreground">
              CSV, TSV, XLSX or XLS — processed privately in your browser
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              className="rounded-xl bg-gradient-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-glow active:scale-95"
            >
              Upload a file
            </button>
            <button
              onClick={onSample}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary/60 px-6 py-3 text-sm font-semibold transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:bg-secondary active:scale-95"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Try a messy sample
            </button>
          </div>
        </FadeIn>

        <FadeIn delay={0.38}>
          <div className="mt-14 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            {STAGES.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-lg border border-border/70 bg-card/50 px-3 py-1.5 font-medium">
                  {s}
                </span>
                {i < STAGES.length - 1 && <span className="text-primary/60">→</span>}
              </span>
            ))}
          </div>
        </FadeIn>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: "Validated schema", body: "Types inferred and enforced on every column." },
            { icon: Gauge, title: "Quality scoring", body: "Before/after score across completeness and validity." },
            { icon: Sparkles, title: "AI analyst", body: "Ask questions about your dataset in plain English." },
          ].map((f, i) => (
            <FadeIn key={f.title} delay={0.45 + i * 0.1}>
              <div className="glass hover-lift h-full rounded-2xl p-5 text-left">
                <f.icon className="h-5 w-5 text-primary" />
                <p className="mt-3 text-sm font-semibold">{f.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
