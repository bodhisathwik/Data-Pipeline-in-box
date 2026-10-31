import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Search, AlertCircle, RotateCcw, X, History } from "lucide-react";
import type { CellChange, PipelineResult, Row } from "@/lib/api";
import { fetchTableData, fetchCellLineage, revertCell } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE = 25;

export function DataTable({
  result,
  onScoreUpdate,
}: {
  result: PipelineResult;
  onScoreUpdate?: (newScore: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [serverRows, setServerRows] = useState<Row[] | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [outliersOnly, setOutliersOnly] = useState(false);

  // Lineage popover state
  const [activeCell, setActiveCell] = useState<{ row: number; col: string; val: any } | null>(null);
  const [lineageData, setLineageData] = useState<any | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [revertLoading, setRevertLoading] = useState(false);

  useEffect(() => {
    if (!result.id) return;
    const timeout = setTimeout(() => {
      fetchTableData(
        result.id!,
        page,
        PAGE,
        sort?.col,
        sort?.dir || "asc",
        query
      )
        .then((res) => {
          setServerRows(res.rows);
          setTotalRows(res.total);
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timeout);
  }, [result.id, page, sort, query]);

  const changeMap = useMemo(() => {
    const m = new Map<string, any>();
    (result.changes || []).forEach((c: any) => {
      const r = c.row_index !== undefined ? c.row_index : c.row;
      const col = c.column_name || c.col;
      m.set(`${r}:${col}`, c);
    });
    return m;
  }, [result.changes]);

  const indexed = useMemo(
    () => (result.cleanRows || []).map((row, i) => ({ row, i })),
    [result.cleanRows],
  );

  const filteredLocal = useMemo(() => {
    let base = indexed;
    if (outliersOnly) {
      base = base.filter(({ row, i }) =>
        result.headers.some((h) => {
          const ch = changeMap.get(`${i}:${h}`);
          return ch && ch.change_type === "outlier";
        })
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      base = base.filter(({ row }) =>
        result.headers.some((h) => String(row[h] ?? "").toLowerCase().includes(q))
      );
    }
    if (!sort) return base;
    return [...base].sort((a, b) => {
      const av = a.row[sort.col];
      const bv = b.row[sort.col];
      if (typeof av === "number" && typeof bv === "number")
        return sort.dir === "asc" ? av - bv : bv - av;
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [indexed, query, sort, result.headers, outliersOnly, changeMap]);

  const displayedRows = serverRows && !outliersOnly
    ? serverRows.map((row, i) => ({ row, i: page * PAGE + i }))
    : filteredLocal.slice(page * PAGE, page * PAGE + PAGE);

  const countTotal = (serverRows && !outliersOnly && totalRows !== null) ? totalRows : filteredLocal.length;
  const pages = Math.max(1, Math.ceil(countTotal / PAGE));
  const current = Math.min(page, pages - 1);

  // Handle cell click for Lineage & Revert
  const handleCellClick = async (rowIdx: number, colName: string, currentVal: any) => {
    if (!result.id) return;
    setActiveCell({ row: rowIdx, col: colName, val: currentVal });
    setLineageLoading(true);
    try {
      const lineage = await fetchCellLineage(result.id, rowIdx, colName);
      setLineageData(lineage);
    } catch {
      setLineageData(null);
    } finally {
      setLineageLoading(false);
    }
  };

  const handleRevert = async () => {
    if (!result.id || !activeCell) return;
    setRevertLoading(true);
    try {
      const res = await revertCell(result.id, activeCell.row, activeCell.col);
      if (res.ok) {
        if (serverRows) {
          setServerRows((prev) =>
            prev ? prev.map((r, i) => (i === activeCell.row ? { ...r, [activeCell.col]: res.reverted_value } : r)) : null
          );
        }
        if (res.new_score && onScoreUpdate) {
          onScoreUpdate(res.new_score);
        }
        setActiveCell(null);
        setLineageData(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRevertLoading(false);
    }
  };

  return (
    <div className="glass relative rounded-2xl border border-white/[0.09] bg-[#090909]">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Cleaned dataset</p>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">
          {countTotal.toLocaleString()} rows
        </span>

        {/* Outlier filter toggle */}
        <button
          onClick={() => {
            setOutliersOnly((prev) => !prev);
            setPage(0);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
            outliersOnly
              ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
              : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Outliers only {result.outliersCount ? `(${result.outliersCount})` : ""}
        </button>

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filter rows..."
            className="w-full rounded-lg border border-border bg-secondary/60 py-2 pl-9 pr-3 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="scrollbar-slim max-h-[520px] overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#0e0e0e]/95 backdrop-blur border-b border-border/60">
            <tr>
              {result.headers.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold text-foreground">
                  <button
                    onClick={() =>
                      setSort((s) =>
                        s?.col === h
                          ? { col: h, dir: s.dir === "asc" ? "desc" : "asc" }
                          : { col: h, dir: "asc" }
                      )
                    }
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
                  >
                    {h}
                    <ArrowUpDown
                      className={cn("h-3 w-3", sort?.col === h ? "text-primary" : "text-muted-foreground/60")}
                    />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map(({ row, i }) => (
              <TableRow
                key={i}
                row={row}
                index={i}
                headers={result.headers}
                changeMap={changeMap}
                onCellClick={(col, val) => handleCellClick(i, col, val)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <span>
          Page {current + 1} of {pages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={current === 0}
            className="rounded-lg border border-border px-3 py-1.5 transition-colors hover:bg-secondary disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={current >= pages - 1}
            className="rounded-lg border border-border px-3 py-1.5 transition-colors hover:bg-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {/* Cell Lineage & Revert Popover Modal */}
      {activeCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Cell Lineage & History</h3>
              </div>
              <button
                onClick={() => {
                  setActiveCell(null);
                  setLineageData(null);
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-muted-foreground">Target Field:</span>
                <span className="font-mono font-medium text-foreground">
                  Row #{activeCell.row} • {activeCell.col}
                </span>
              </div>

              {lineageLoading ? (
                <div className="py-6 text-center text-muted-foreground">Loading audit trail...</div>
              ) : lineageData ? (
                <>
                  <div className="rounded-xl border border-white/5 bg-[#141414] p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Original Value:</span>
                      <span className="font-mono text-amber-400">
                        {lineageData.original_value !== null && lineageData.original_value !== ""
                          ? String(lineageData.original_value)
                          : "<empty>"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Value:</span>
                      <span className="font-mono text-teal-400">
                        {String(lineageData.current_value)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Change Type:</span>
                      <span className="font-semibold uppercase tracking-wider text-xs text-foreground">
                        {lineageData.change_type}
                      </span>
                    </div>
                    <div className="pt-1 text-[11px] text-muted-foreground">
                      <strong>Rule:</strong> {lineageData.rule_applied}
                    </div>
                  </div>

                  {lineageData.change_type !== "unchanged" && (
                    <div className="pt-2">
                      <button
                        onClick={handleRevert}
                        disabled={revertLoading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500/15 border border-amber-500/30 px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {revertLoading ? "Reverting..." : "Revert this fix to original"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-4 text-muted-foreground">No historical modifications recorded.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableRow({
  row,
  index,
  headers,
  changeMap,
  onCellClick,
}: {
  row: Row;
  index: number;
  headers: string[];
  changeMap: Map<string, any>;
  onCellClick: (col: string, val: any) => void;
}) {
  return (
    <tr className="border-t border-border/50 transition-colors duration-200 hover:bg-white/[0.03]">
      {headers.map((h) => {
        const change = changeMap.get(`${index}:${h}`);
        const isOutlier = change?.change_type === "outlier";
        const val = row[h];

        return (
          <td
            key={h}
            onClick={() => onCellClick(h, val)}
            className="max-w-[220px] truncate px-3 py-2 cursor-pointer hover:bg-white/[0.05] transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              {isOutlier ? (
                <span
                  title={change.rule_applied || `Outlier detected: value broke IQR bounds`}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30"
                >
                  outlier
                </span>
              ) : change ? (
                <span
                  title={`${change.rule_applied || change.reason || "Modified"} (Original: ${change.original_value ?? change.from ?? "empty"})`}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400"
                />
              ) : null}

              <span className={cn(change ? "text-foreground font-medium" : "text-muted-foreground")}>
                {String(val ?? "")}
              </span>
            </span>
          </td>
        );
      })}
    </tr>
  );
}
