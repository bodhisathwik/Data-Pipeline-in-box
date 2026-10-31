import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Loader2, Send, X, Code2 } from "lucide-react";
import { fetchSuggestions, askDataAI, type PipelineResult, type Row } from "@/lib/api";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  text: string;
  sql?: string | undefined;
  table?: { headers: string[]; rows: Row[] } | undefined;
};

const DEFAULT_SUGGESTIONS = [
  "Summarize this dataset",
  "Which columns had the most missing values?",
  "What drove the quality score change?",
  "Show me 5 sample rows",
];

export function ChatWidget({ result }: { result: PipelineResult }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: `I've loaded "${result.fileName}" — ${result.cleanRows.length} cleaned rows across ${result.headers.length} columns. Ask me anything about it.`,
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result.id) {
      fetchSuggestions(result.id).then((suggs) => {
        if (suggs && suggs.length > 0) setSuggestions(suggs);
      }).catch(() => {});
    }
  }, [result.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      if (result.id) {
        const res = await askDataAI(result.id, text);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: res.answer || "No response generated.",
            sql: res.sql,
            table: res.table || undefined,
          },
        ]);
      } else {
        // Local preview fallback
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Processed ${result.cleanRows.length} rows for "${result.fileName}". Quality score is ${result.scoreAfter}/100.`,
            table: { headers: result.headers.slice(0, 5), rows: result.cleanRows.slice(0, 5) },
          },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Something went wrong reaching the AI assistant. Please verify your connection." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow"
        aria-label="Open AI assistant"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-6 w-6" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="glass fixed bottom-24 right-4 z-50 flex h-[70vh] max-h-[560px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Data Assistant</p>
                <p className="text-[11px] text-muted-foreground">Grounded in your cleaned dataset</p>
              </div>
            </div>

            <div className="scrollbar-slim flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-gradient-primary text-primary-foreground"
                        : "bg-secondary/80 text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.sql && (
                      <div className="mt-2 rounded-lg border border-border/60 bg-black/40 p-2 font-mono text-[10px] text-primary">
                        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                          <Code2 className="h-3 w-3" /> Generated SQL
                        </div>
                        <code>{m.sql}</code>
                      </div>
                    )}
                    {m.table && (
                      <div className="mt-2 overflow-x-auto rounded-lg border border-border/70">
                        <table className="w-full text-[11px]">
                          <thead className="bg-card/70">
                            <tr>
                              {m.table.headers.map((h) => (
                                <th key={h} className="px-2 py-1 text-left font-medium">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {m.table.rows.map((r, ri) => (
                              <tr key={ri} className="border-t border-border/60">
                                {m.table!.headers.map((h) => (
                                  <td key={h} className="max-w-24 truncate px-2 py-1">
                                    {String(r[h] ?? "")}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing your data...
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-border/60 px-3 pb-3 pt-2">
              <div className="scrollbar-slim mb-2 flex gap-2 overflow-x-auto pb-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="whitespace-nowrap rounded-full border border-border bg-secondary/60 px-3 py-1 text-[11px] transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/60"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your data..."
                  className="flex-1 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.92 }}
                  disabled={busy}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </motion.button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
