import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type ColType = "number" | "date" | "boolean" | "text";

export type CellChange = { row: number; col: string; from: Cell; to: Cell; reason: string };

export type ColumnProfile = {
  name: string;
  original: string;
  type: ColType;
  missingBefore: number;
  missingAfter: number;
  uniqueCount: number;
  distribution: { label: string; value: number }[];
};

export type PipelineResult = {
  fileName: string;
  rawRows: Row[];
  rawHeaders: string[];
  cleanRows: Row[];
  headers: string[];
  columns: ColumnProfile[];
  duplicatesRemoved: number;
  missingFixed: number;
  typesFixed: number;
  renamedColumns: { from: string; to: string }[];
  scoreBefore: number;
  scoreAfter: number;
  changes: CellChange[];
  log: string[];
};

const NULLISH = new Set(["", "na", "n/a", "null", "none", "nan", "-", "--", "undefined", "?"]);

export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  return NULLISH.has(String(v).trim().toLowerCase());
}

export function standardizeName(name: string, index: number): string {
  const cleaned = String(name ?? "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return cleaned || `column_${index + 1}`;
}

function parseNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null) return null;
  const s = String(v)
    .trim()
    .replace(/[$€£,\s]/g, "")
    .replace(/%$/, "");
  if (!s || !/^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function looksLikeDate(v: Cell): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length < 6) return false;
  return /^\d{4}-\d{1,2}-\d{1,2}/.test(s) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s);
}

function looksLikeBool(v: Cell): boolean {
  return typeof v === "string" && /^(true|false|yes|no|y|n)$/i.test(v.trim());
}

function inferType(values: Cell[]): ColType {
  const present = values.filter((v) => !isBlank(v));
  if (!present.length) return "text";
  const num = present.filter((v) => parseNumber(v) !== null).length;
  if (num / present.length >= 0.8) return "number";
  const dt = present.filter(looksLikeDate).length;
  if (dt / present.length >= 0.8) return "date";
  const bo = present.filter(looksLikeBool).length;
  if (bo / present.length >= 0.8) return "boolean";
  return "text";
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mode(vals: string[]): string {
  const counts = new Map<string, number>();
  vals.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let best = "Unknown";
  let n = -1;
  counts.forEach((c, v) => {
    if (c > n) {
      n = c;
      best = v;
    }
  });
  return best;
}

export async function parseFile(file: File): Promise<{ headers: string[]; rows: Row[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    const text = await file.text();
    const res = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
    });
    const headers = (res.meta.fields ?? []).filter(Boolean);
    return { headers, rows: res.data as Row[] };
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const json = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: true });
  const headers = json.length ? Object.keys(json[0]!) : [];
  return { headers, rows: json };
}

function qualityScore(rows: Row[], headers: string[], dupes: number, typeIssues: number): number {
  if (!rows.length || !headers.length) return 0;
  const total = rows.length * headers.length;
  let missing = 0;
  rows.forEach((r) => headers.forEach((h) => (isBlank(r[h]) ? missing++ : null)));
  const completeness = 1 - missing / total;
  const uniqueness = 1 - dupes / rows.length;
  const validity = 1 - typeIssues / total;
  const score = completeness * 0.5 + uniqueness * 0.25 + validity * 0.25;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

export function runPipeline(fileName: string, rawHeaders: string[], rawRows: Row[]): PipelineResult {
  const log: string[] = [];
  const changes: CellChange[] = [];
  log.push(`Ingested "${fileName}" — ${rawRows.length} rows × ${rawHeaders.length} columns`);

  // 1. Standardize column names
  const renamedColumns: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  const headerMap = new Map<string, string>();
  rawHeaders.forEach((h, i) => {
    let std = standardizeName(h, i);
    while (seen.has(std)) std = `${std}_${i + 1}`;
    seen.add(std);
    headerMap.set(h, std);
    if (std !== h) renamedColumns.push({ from: h, to: std });
  });
  const headers = rawHeaders.map((h) => headerMap.get(h)!);
  if (renamedColumns.length)
    log.push(`Standardized ${renamedColumns.length} column name(s) to snake_case`);

  let rows: Row[] = rawRows.map((r) => {
    const out: Row = {};
    rawHeaders.forEach((h) => {
      const v = r[h];
      out[headerMap.get(h)!] = typeof v === "string" ? v.trim() : ((v ?? null) as Cell);
    });
    return out;
  });

  // 2. Remove duplicate rows
  const sigSeen = new Set<string>();
  const deduped: Row[] = [];
  let duplicatesRemoved = 0;
  rows.forEach((r) => {
    const sig = headers.map((h) => String(r[h] ?? "").toLowerCase()).join("\u0001");
    if (sigSeen.has(sig)) {
      duplicatesRemoved++;
      return;
    }
    sigSeen.add(sig);
    deduped.push(r);
  });
  if (duplicatesRemoved) log.push(`Removed ${duplicatesRemoved} duplicate row(s)`);
  else log.push("No duplicate rows detected");

  // 3. Infer types
  const types = new Map<string, ColType>();
  headers.forEach((h) =>
    types.set(
      h,
      inferType(deduped.map((r) => r[h] ?? null)),
    ),
  );

  let typesFixed = 0;
  let missingFixed = 0;
  let typeIssuesBefore = 0;

  const missingBefore = new Map<string, number>();
  headers.forEach((h) =>
    missingBefore.set(h, deduped.filter((r) => isBlank(r[h])).length),
  );

  // 4. Coerce types + fill nulls
  const fillValues = new Map<string, Cell>();
  headers.forEach((h) => {
    const t = types.get(h)!;
    if (t === "number") {
      const nums = deduped
        .map((r) => parseNumber(r[h] ?? null))
        .filter((n): n is number => n !== null);
      fillValues.set(h, Math.round(median(nums) * 100) / 100);
    } else if (t === "boolean") {
      fillValues.set(h, "false");
    } else {
      const vals = deduped
        .map((r) => r[h])
        .filter((v) => !isBlank(v))
        .map((v) => String(v));
      fillValues.set(h, vals.length ? mode(vals) : "Unknown");
    }
  });

  rows = deduped.map((r, i) => {
    const out: Row = {};
    headers.forEach((h) => {
      const t = types.get(h)!;
      const original = r[h] ?? null;
      let value: Cell = original;

      if (isBlank(value)) {
        value = fillValues.get(h)!;
        missingFixed++;
        changes.push({
          row: i,
          col: h,
          from: original,
          to: value,
          reason:
            t === "number"
              ? "Missing value imputed with column median"
              : "Missing value imputed with most frequent value",
        });
      } else if (t === "number") {
        const n = parseNumber(value);
        if (n === null) {
          typeIssuesBefore++;
          const fallback = fillValues.get(h)!;
          changes.push({
            row: i,
            col: h,
            from: original,
            to: fallback,
            reason: "Invalid numeric value replaced with column median",
          });
          value = fallback;
          typesFixed++;
        } else if (n !== original) {
          value = n;
          typesFixed++;
          changes.push({
            row: i,
            col: h,
            from: original,
            to: n,
            reason: "Coerced text to number",
          });
        }
      } else if (t === "boolean") {
        const norm = /^(true|yes|y)$/i.test(String(value)) ? "true" : "false";
        if (norm !== String(value)) {
          value = norm;
          typesFixed++;
          changes.push({ row: i, col: h, from: original, to: norm, reason: "Normalized boolean" });
        }
      } else if (typeof value === "string") {
        const norm = value.replace(/\s+/g, " ").trim();
        if (norm !== value) {
          value = norm;
          typesFixed++;
          changes.push({
            row: i,
            col: h,
            from: original,
            to: norm,
            reason: "Trimmed whitespace",
          });
        }
      }
      out[h] = value;
    });
    return out;
  });

  if (missingFixed) log.push(`Imputed ${missingFixed} missing value(s)`);
  if (typesFixed) log.push(`Fixed ${typesFixed} type / formatting issue(s)`);
  log.push(`Validated ${rows.length} rows against inferred schema`);

  const columns: ColumnProfile[] = headers.map((h, idx) => {
    const t = types.get(h)!;
    const values: Cell[] = rows.map((r) => r[h] ?? null);
    let distribution: { label: string; value: number }[] = [];
    if (t === "number") {
      const nums = values.map((v) => parseNumber(v) ?? 0);
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const bins = 6;
      const width = (max - min) / bins || 1;
      distribution = Array.from({ length: bins }, (_, b) => ({
        label: `${Math.round((min + b * width) * 10) / 10}`,
        value: nums.filter((n) => n >= min + b * width && (b === bins - 1 ? n <= max : n < min + (b + 1) * width)).length,
      }));
    } else {
      const counts = new Map<string, number>();
      values.forEach((v) => {
        const k = String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      });
      distribution = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([label, value]) => ({ label, value }));
    }
    return {
      name: h,
      original: rawHeaders[idx] ?? h,
      type: t,
      missingBefore: missingBefore.get(h) ?? 0,
      missingAfter: 0,
      uniqueCount: new Set(values.map((v) => String(v))).size,
      distribution,
    };
  });

  const rawStd: Row[] = rawRows.map((r) => {
    const out: Row = {};
    rawHeaders.forEach((h) => (out[headerMap.get(h)!] = (r[h] ?? null) as Cell));
    return out;
  });

  const scoreBefore = qualityScore(rawStd, headers, duplicatesRemoved, typeIssuesBefore);
  const scoreAfter = qualityScore(rows, headers, 0, 0);
  log.push(`Stored cleaned dataset — quality score ${scoreBefore} → ${scoreAfter}`);

  return {
    fileName,
    rawRows: rawStd,
    rawHeaders,
    cleanRows: rows,
    headers,
    columns,
    duplicatesRemoved,
    missingFixed,
    typesFixed,
    renamedColumns,
    scoreBefore,
    scoreAfter,
    changes,
    log,
  };
}

export function toCSV(headers: string[], rows: Row[]): string {
  return Papa.unparse({ fields: headers, data: rows.map((r) => headers.map((h) => r[h] ?? "")) });
}

export function buildReport(result: PipelineResult): string {
  const lines = [
    "DATA QUALITY REPORT",
    "===================",
    `File: ${result.fileName}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    `Rows processed: ${result.rawRows.length}`,
    `Rows after cleaning: ${result.cleanRows.length}`,
    `Duplicates removed: ${result.duplicatesRemoved}`,
    `Missing values fixed: ${result.missingFixed}`,
    `Type/format fixes: ${result.typesFixed}`,
    `Quality score: ${result.scoreBefore} -> ${result.scoreAfter}`,
    "",
    "COLUMNS",
    "-------",
    ...result.columns.map(
      (c) =>
        `${c.name} (${c.type}) | original: "${c.original}" | missing before: ${c.missingBefore} | unique: ${c.uniqueCount}`,
    ),
    "",
    "CLEANING LOG",
    "------------",
    ...result.log.map((l) => `- ${l}`),
  ];
  return lines.join("\n");
}
