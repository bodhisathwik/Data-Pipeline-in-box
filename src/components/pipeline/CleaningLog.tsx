import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";

export function CleaningLog({ lines }: { lines: string[] }) {
  const [rendered, setRendered] = useState<string[]>([]);
  const [typing, setTyping] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRendered([]);
    setTyping("");
    let line = 0;
    let char = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || line >= lines.length) return;
      const current = lines[line] ?? "";
      char += 2;
      if (char >= current.length) {
        setRendered((r) => [...r, current]);
        setTyping("");
        line++;
        char = 0;
        setTimeout(tick, 220);
      } else {
        setTyping(current.slice(0, char));
        setTimeout(tick, 16);
      }
    };
    const start = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [lines]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [rendered, typing]);

  return (
    <div className="glass flex h-full flex-col rounded-2xl">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Terminal className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Cleaning Log</p>
        <span className="ml-auto flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </span>
      </div>
      <div
        ref={boxRef}
        className="scrollbar-slim max-h-72 min-h-52 flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {rendered.map((l, i) => (
          <p key={i} className="text-muted-foreground">
            <span className="text-primary">$</span> {l}
          </p>
        ))}
        {typing && (
          <p className="text-foreground">
            <span className="text-primary">$</span> {typing}
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-primary align-middle" />
          </p>
        )}
        {!typing && rendered.length === lines.length && (
          <p className="text-success">✓ Pipeline finished — dataset ready.</p>
        )}
      </div>
    </div>
  );
}
