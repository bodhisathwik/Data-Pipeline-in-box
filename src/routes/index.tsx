import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Landing } from "@/components/pipeline/Landing";
import { Processing } from "@/components/pipeline/Processing";
import { Dashboard } from "@/components/pipeline/Dashboard";
import { parseFile, runPipeline } from "@/lib/pipeline";
import { sampleFile } from "@/lib/sample-data";
import { uploadDataset, fetchRun, type PipelineResult } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Data Pipeline in a Box — Clean, Score & Visualize Your Data" },
      {
        name: "description",
        content:
          "Upload a messy CSV or Excel file and watch a live pipeline clean, validate, score and visualize it — with an AI analyst for plain-English questions.",
      },
      { property: "og:title", content: "Data Pipeline in a Box" },
      {
        property: "og:description",
        content:
          "Turn messy data into clean insights instantly: automated cleaning, quality scoring, charts and an AI data assistant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Phase = "landing" | "processing" | "dashboard";

function Index() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const { theme, toggle } = useTheme();

  const handleFile = useCallback(async (file: File) => {
    setPhase("processing");
    try {
      // 1. Try uploading to real backend API
      try {
        const uploadRes = await uploadDataset(file);
        if (uploadRes && uploadRes.run_id) {
          setActiveRunId(uploadRes.run_id);
          return;
        }
      } catch (backendErr) {
        console.warn("Backend upload failed, using local pipeline fallback:", backendErr);
      }

      // 2. Fallback to client-side pipeline if backend is not reachable
      const { headers, rows } = await parseFile(file);
      if (!headers.length || !rows.length) throw new Error("empty");
      setResult(runPipeline(file.name, headers, rows));
    } catch {
      toast.error("Could not read that file. Try a CSV or Excel file with a header row.");
      setPhase("landing");
    }
  }, []);

  const handleProcessingDone = useCallback(async () => {
    if (activeRunId) {
      try {
        const fullRun = await fetchRun(activeRunId);
        setResult(fullRun);
        setPhase("dashboard");
        toast.success("Pipeline complete — your dataset is clean in MySQL.");
        return;
      } catch (err) {
        console.error("Error fetching run from backend:", err);
      }
    }

    if (result) {
      setPhase("dashboard");
      toast.success("Pipeline complete — your dataset is clean.");
    }
  }, [activeRunId, result]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
      >
        {phase === "landing" && (
          <Landing onFile={(f) => void handleFile(f)} onSample={() => void handleFile(sampleFile())} />
        )}
        {phase === "processing" && (
          <Processing
            runId={activeRunId}
            onDone={() => void handleProcessingDone()}
          />
        )}
        {phase === "dashboard" && result && (
          <Dashboard
            result={result}
            theme={theme}
            onToggleTheme={toggle}
            onReset={() => {
              setResult(null);
              setActiveRunId(null);
              setPhase("landing");
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
