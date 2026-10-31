import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PipelineResult } from "@/lib/api";
import { FadeIn } from "./primitives";
import { cn } from "@/lib/utils";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

function Panel({
  title,
  subtitle,
  children,
  delay = 0,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <FadeIn delay={delay} className={className}>
      <div className="glass h-full rounded-2xl p-4 sm:p-5">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </FadeIn>
  );
}

export function Charts({ result }: { result: PipelineResult }) {
  const [col, setCol] = useState(result.columns[0]?.name ?? "");
  const active = result.columns.find((c) => c.name === col) ?? result.columns[0];

  const typeData = Object.entries(
    result.columns.reduce<Record<string, number>>((acc, c) => {
      acc[c.type] = (acc[c.type] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const rowData = [
    { name: "Raw rows", value: result.rawRows.length },
    { name: "Cleaned rows", value: result.cleanRows.length },
  ];

  const maxMissing = Math.max(1, ...result.columns.map((c) => c.missingBefore));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Column distribution"
        subtitle="Top values or numeric bins for the selected column"
        delay={0}
      >
        <select
          value={col}
          onChange={(e) => setCol(e.target.value)}
          className="mb-3 w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          {result.columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={active?.distribution ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              interval="preserveStartEnd"
              tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 10)}…` : v)}
            />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={30} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="var(--chart-1)" animationDuration={900} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Missing values heatmap" subtitle="Nulls detected per column before cleaning" delay={0.1}>
        <div className="scrollbar-slim max-h-[260px] space-y-2 overflow-y-auto pr-1">
          {result.columns.map((c) => {
            const ratio = c.missingBefore / maxMissing;
            return (
              <div key={c.name} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{c.name}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-md transition-all duration-1000 ease-[cubic-bezier(0.4,0,0.2,1)]",
                      c.missingBefore === 0
                        ? "bg-success/40"
                        : ratio > 0.6
                          ? "bg-destructive/70"
                          : ratio > 0.25
                            ? "bg-warning/70"
                            : "bg-primary/60",
                    )}
                    style={{ width: `${Math.max(c.missingBefore === 0 ? 6 : 12, ratio * 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums">{c.missingBefore}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Data type breakdown" subtitle="Inferred schema across all columns" delay={0.2}>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={typeData}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={92}
              paddingAngle={3}
              animationDuration={1000}
            >
              {typeData.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
          {typeData.map((t, i) => (
            <span key={t.name} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              {t.name} · {t.value}
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Row count before / after" subtitle="Impact of de-duplication" delay={0.3}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rowData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={40} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
            <Bar dataKey="value" radius={[8, 8, 0, 0]} animationDuration={900}>
              <Cell fill="var(--chart-4)" />
              <Cell fill="var(--chart-3)" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
