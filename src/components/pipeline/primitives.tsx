import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { cn } from "@/lib/utils";

export function CountUp({
  value,
  duration = 1400,
  decimals = 0,
}: {
  value: number;
  duration?: number;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setDisplay(value * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {display.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}

export function ScoreRing({
  value,
  size = 148,
  label = "Quality Score",
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setProgress(value), 250);
    return () => clearTimeout(id);
  }, [value]);

  const tone =
    value >= 85 ? "var(--success)" : value >= 65 ? "var(--primary)" : value >= 45 ? "var(--warning)" : "var(--destructive)";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (progress / 100) * c}
            style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold">
            <CountUp value={value} />
          </span>
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} fill="none">
      <motion.path
        d="M4 12.5l5 5L20 6.5"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      />
    </svg>
  );
}

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string | undefined;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay, ease: [0.4, 0, 0.2, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="blob"
        style={{
          width: 520,
          height: 520,
          top: "-12%",
          left: "-8%",
          background: "var(--primary)",
          animationDelay: "0s",
        }}
      />
      <div
        className="blob"
        style={{
          width: 460,
          height: 460,
          top: "20%",
          right: "-10%",
          background: "var(--accent)",
          animationDelay: "-6s",
        }}
      />
      <div
        className="blob"
        style={{
          width: 380,
          height: 380,
          bottom: "-15%",
          left: "35%",
          background: "var(--chart-5)",
          opacity: 0.3,
          animationDelay: "-12s",
        }}
      />
    </div>
  );
}
