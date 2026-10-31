import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Info } from "lucide-react";

export function QualityRadarChart({
  dimensions,
}: {
  dimensions?: {
    completeness: { before: number; after: number; weight?: number };
    uniqueness: { before: number; after: number; weight?: number };
    validity: { before: number; after: number; weight?: number };
    consistency: { before: number; after: number; weight?: number };
  };
}) {
  const d = dimensions || {
    completeness: { before: 82, after: 100, weight: 0.30 },
    uniqueness: { before: 88, after: 100, weight: 0.25 },
    validity: { before: 78, after: 96, weight: 0.25 },
    consistency: { before: 72, after: 100, weight: 0.20 },
  };

  const chartData = [
    {
      dimension: "Completeness",
      desc: "Share of non-null, fully populated fields (Weight: 30%)",
      before: Math.round(d.completeness?.before ?? 80),
      after: Math.round(d.completeness?.after ?? 100),
    },
    {
      dimension: "Uniqueness",
      desc: "Share of distinct rows without duplicates (Weight: 25%)",
      before: Math.round(d.uniqueness?.before ?? 85),
      after: Math.round(d.uniqueness?.after ?? 100),
    },
    {
      dimension: "Validity",
      desc: "Conformity to expected data types and constraints (Weight: 25%)",
      before: Math.round(d.validity?.before ?? 80),
      after: Math.round(d.validity?.after ?? 95),
    },
    {
      dimension: "Consistency",
      desc: "Uniform formatting, casing, and syntax patterns (Weight: 20%)",
      before: Math.round(d.consistency?.before ?? 75),
      after: Math.round(d.consistency?.after ?? 100),
    },
  ];

  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-center justify-between pb-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          4D Quality Radar
        </p>
        <div className="group relative cursor-pointer">
          <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          <div className="absolute right-0 top-5 z-50 hidden w-56 rounded-xl border border-white/10 bg-[#0e0e0e] p-3 text-[11px] leading-relaxed text-muted-foreground shadow-2xl group-hover:block">
            <p className="font-semibold text-foreground mb-1">Quality Dimensions:</p>
            <p>• <strong className="text-foreground">Completeness (30%):</strong> Non-null values</p>
            <p>• <strong className="text-foreground">Uniqueness (25%):</strong> Non-duplicate rows</p>
            <p>• <strong className="text-foreground">Validity (25%):</strong> Type compliance</p>
            <p>• <strong className="text-foreground">Consistency (20%):</strong> Pattern harmony</p>
          </div>
        </div>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 10 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 8 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="rounded-xl border border-white/10 bg-[#121212] p-2.5 text-xs shadow-xl backdrop-blur-md">
                      <p className="font-semibold text-foreground">{data.dimension}</p>
                      <p className="text-[10px] text-muted-foreground mb-2">{data.desc}</p>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#888888]">Before:</span>
                          <span className="font-semibold text-[#888888]">{data.before}%</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-teal-400">After:</span>
                          <span className="font-semibold text-teal-400">{data.after}%</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Radar
              name="Before"
              dataKey="before"
              stroke="#666666"
              fill="#666666"
              fillOpacity={0.25}
            />
            <Radar
              name="After"
              dataKey="after"
              stroke="#2dd4bf"
              fill="#2dd4bf"
              fillOpacity={0.45}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground pt-1">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#666666]" />
          Before Cleaning
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-teal-400" />
          After Cleaning
        </span>
      </div>
    </div>
  );
}

