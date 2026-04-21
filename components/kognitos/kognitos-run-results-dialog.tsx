"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isMarkdownTableSeparatorRow,
  markdownReportTextFromOutputs,
  splitMarkdownTableCells,
} from "@/lib/kognitos/markdown-report-supplier-invoice";
import type { KognitosDashboardRun } from "@/lib/kognitos/normalize-dashboard-run";
import { cn } from "@/lib/utils";

function mergeRunOutputs(payload: Record<string, unknown>): Record<string, unknown> {
  const st = payload.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) {
    return payload.outputs &&
      typeof payload.outputs === "object" &&
      !Array.isArray(payload.outputs)
      ? (payload.outputs as Record<string, unknown>)
      : {};
  }
  const completed = (st as Record<string, unknown>).completed as
    | Record<string, unknown>
    | undefined;
  const completedOut =
    completed?.outputs &&
    typeof completed.outputs === "object" &&
    !Array.isArray(completed.outputs)
      ? (completed.outputs as Record<string, unknown>)
      : {};
  const topOut =
    payload.outputs &&
    typeof payload.outputs === "object" &&
    !Array.isArray(payload.outputs)
      ? (payload.outputs as Record<string, unknown>)
      : {};
  return { ...topOut, ...completedOut };
}

function pickMergedString(
  merged: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = merged[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Limits decimal places in plain-text / markdown report numbers to **at most 2**
 * fractional digits (e.g. long unit prices in SAP tables). Leaves integers and
 * values that already use 0–2 decimal places unchanged.
 */
function limitFractionDigitsInReportMarkdown(text: string): string {
  return text.replace(
    /\b-?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{3,})\b/g,
    (match, intPart: string, frac: string) => {
      const sign = match.startsWith("-") ? "-" : "";
      const intDigits = intPart.replace(/,/g, "");
      const n = parseFloat(`${sign}${intDigits}.${frac}`);
      if (!Number.isFinite(n)) return match;
      const useGrouping = intPart.includes(",");
      return n.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
        useGrouping,
      });
    },
  );
}

const markdownComponents: Components = {
  h1: ({ className, ...props }) => (
    <h1
      className={cn("mt-4 text-lg font-semibold tracking-tight first:mt-0", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mt-6 border-b border-border pb-1 text-base font-semibold tracking-tight first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn("mt-4 text-sm font-semibold text-foreground", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("my-2 text-sm leading-relaxed", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("my-2 list-disc pl-5 text-sm", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("my-2 list-decimal pl-5 text-sm", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("my-0.5", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table
        className={cn("w-full min-w-[520px] border-collapse text-sm", className)}
        {...props}
      />
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead className={cn("bg-muted/50", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border-b border-border px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "border-b border-border px-2 py-2 align-top text-foreground",
        className,
      )}
      {...props}
    />
  ),
  tr: (props) => <tr {...props} />,
  code: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground",
        className,
      )}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-2 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs",
        className,
      )}
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold text-foreground", className)} {...props} />
  ),
};

function normalizeMdCell(c: string): string {
  return c.replace(/\*+/g, "").trim();
}

type ValResColMap = {
  checkName: number;
  expected?: number;
  actual?: number;
  status?: number;
};

function tryParseValidationResultsHeader(cells: string[]): ValResColMap | null {
  if (cells.length < 2) return null;
  let checkIdx = -1;
  let expectedIdx = -1;
  let actualIdx = -1;
  let statusIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const raw = normalizeMdCell(cells[i] ?? "");
    const c = raw.toLowerCase();
    if (
      checkIdx < 0 &&
      (c === "check name" ||
        c === "check_name" ||
        c === "checkname" ||
        /^check\s*name$/i.test(raw))
    ) {
      checkIdx = i;
    }
    if (expectedIdx < 0 && (c === "expected" || /^expected(\s+value)?$/i.test(raw))) {
      expectedIdx = i;
    }
    if (actualIdx < 0 && (c === "actual" || /^actual(\s+value)?$/i.test(raw))) {
      actualIdx = i;
    }
    if (statusIdx < 0 && (c === "status" || /^status$/i.test(raw))) {
      statusIdx = i;
    }
  }
  if (checkIdx < 0) return null;
  if (expectedIdx < 0 && actualIdx < 0) return null;
  const out: ValResColMap = { checkName: checkIdx };
  if (expectedIdx >= 0) out.expected = expectedIdx;
  if (actualIdx >= 0) out.actual = actualIdx;
  if (statusIdx >= 0) out.status = statusIdx;
  return out;
}

function normalizeComparableScalar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ");
}

function expectedActualSemanticallyEqual(a: string, b: string): boolean {
  const na = normalizeComparableScalar(a);
  const nb = normalizeComparableScalar(b);
  if (na === nb) return true;
  const digitsA = na.replace(/[^\d.-]/g, "");
  const digitsB = nb.replace(/[^\d.-]/g, "");
  if (!digitsA || !digitsB) return false;
  const fa = parseFloat(digitsA);
  const fb = parseFloat(digitsB);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return false;
  return Math.abs(fa - fb) < 1e-6;
}

/** Row is incorrect when Status is FAIL (or equivalent), per SAP validation tables. */
function statusIndicatesFailRow(status: string): boolean {
  const t = status.trim();
  if (!t) return false;
  const u = t.toUpperCase();
  if (u === "FAIL" || u === "FAILED" || u === "FALSE" || u === "NO") return true;
  if (/\b(FAIL|FAILED)\b/i.test(t)) return true;
  if (/\b(MISMATCH|REJECT|ERROR)\b/i.test(u)) return true;
  return false;
}

function statusIndicatesDiscrepancyRow(status: string): boolean {
  const t = status.trim();
  if (!t) return false;
  const u = t.toUpperCase();
  if (/\bDISCREPANCY\b/i.test(t)) return true;
  if (u.includes("DISCREPANCY")) return true;
  return false;
}

function cellSaysFail(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /\bFAIL(ED)?\b/i.test(t);
}

function splitAtValidationResultsSection(md: string): {
  before: string;
  validationInner: string | null;
  after: string;
} {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s+validation\s+results\s*$/i.test(lines[i].trim())) {
      const before = lines.slice(0, i).join("\n");
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j])) break;
      }
      const validationInner = lines.slice(i + 1, j).join("\n");
      const after = lines.slice(j).join("\n");
      return {
        before,
        validationInner: validationInner.trim() || null,
        after,
      };
    }
  }
  return { before: md, validationInner: null, after: "" };
}

function splitAtVarianceAnalysisSection(md: string): {
  before: string;
  varianceInner: string | null;
  after: string;
} {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s+variance\s+analysis\s*$/i.test(lines[i].trim())) {
      const before = lines.slice(0, i).join("\n");
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j])) break;
      }
      const varianceInner = lines.slice(i + 1, j).join("\n");
      const after = lines.slice(j).join("\n");
      return {
        before,
        varianceInner: varianceInner.trim() || null,
        after,
      };
    }
  }
  return { before: md, varianceInner: null, after: "" };
}

type VarColMap = {
  comparison?: number;
  quantityVariance?: number;
  valueVariance?: number;
  status: number;
};

function tryParseVarianceAnalysisHeader(cells: string[]): VarColMap | null {
  if (cells.length < 2) return null;
  let comparisonIdx = -1;
  let qtyVarIdx = -1;
  let valueVarIdx = -1;
  let statusIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const raw = normalizeMdCell(cells[i] ?? "");
    const c = raw.toLowerCase();
    if (c === "comparison" || /^comparison$/i.test(raw)) comparisonIdx = i;
    if (/quantity\s*variance/i.test(c) || /^quantity\s*variance$/i.test(raw)) {
      qtyVarIdx = i;
    }
    if (/value\s*variance/i.test(c) || /^value\s*variance$/i.test(raw)) {
      valueVarIdx = i;
    }
    if (c === "status" || /^status$/i.test(raw)) statusIdx = i;
  }
  if (statusIdx < 0) return null;
  const out: VarColMap = { status: statusIdx };
  if (comparisonIdx >= 0) out.comparison = comparisonIdx;
  if (qtyVarIdx >= 0) out.quantityVariance = qtyVarIdx;
  if (valueVarIdx >= 0) out.valueVariance = valueVarIdx;
  return out;
}

function ValidationResultsSectionTable({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  let colMap: ValResColMap | null = null;
  let headerCells: string[] | null = null;
  const bodyRows: { cells: string[]; highlightActual: boolean }[] = [];

  for (const line of lines) {
    const rawCells = splitMarkdownTableCells(line);
    if (!rawCells) continue;
    if (isMarkdownTableSeparatorRow(rawCells)) continue;
    if (!colMap) {
      const m = tryParseValidationResultsHeader(rawCells);
      if (m) {
        colMap = m;
        headerCells = rawCells.map(normalizeMdCell);
      }
      continue;
    }
    const maybeNew = tryParseValidationResultsHeader(rawCells);
    if (maybeNew) {
      colMap = maybeNew;
      headerCells = rawCells.map(normalizeMdCell);
      bodyRows.length = 0;
      continue;
    }
    const cells = rawCells.map(normalizeMdCell);
    while (cells.length < (headerCells?.length ?? 0)) cells.push("");
    const get = (idx?: number) =>
      idx !== undefined && idx < cells.length ? cells[idx]! : "";
    const status = colMap.status !== undefined ? get(colMap.status) : "";
    const expected = colMap.expected !== undefined ? get(colMap.expected) : "";
    const actual = colMap.actual !== undefined ? get(colMap.actual) : "";
    const failStatus = statusIndicatesFailRow(status);
    const valueMismatch =
      expected.trim().length > 0 &&
      actual.trim().length > 0 &&
      !expectedActualSemanticallyEqual(expected, actual);
    const highlightActual = failStatus || valueMismatch;
    bodyRows.push({ cells, highlightActual });
  }

  if (!colMap || !headerCells) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {source}
      </ReactMarkdown>
    );
  }

  const thClass =
    "border-b border-border px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
  const tdBase = "border-b border-border px-2 py-2 align-top text-foreground";

  return (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead className="bg-muted/50">
          <tr>
            {headerCells.map((h, idx) => (
              <th key={idx} className={thClass}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.length === 0 ? (
            <tr>
              <td
                colSpan={headerCells.length}
                className={cn(tdBase, "text-muted-foreground")}
              >
                No data rows parsed in this section.
              </td>
            </tr>
          ) : (
            bodyRows.map((row, ri) => (
              <tr key={ri}>
                {headerCells.map((_, ci) => {
                  const cell = row.cells[ci] ?? "";
                  const isActualCol = colMap!.actual === ci;
                  return (
                    <td
                      key={ci}
                      className={cn(
                        tdBase,
                        isActualCol &&
                          row.highlightActual &&
                          "text-emerald-600 dark:text-emerald-400",
                        cellSaysFail(cell) && !isActualCol && "font-bold",
                      )}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function VarianceAnalysisSectionTable({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  let colMap: VarColMap | null = null;
  let headerCells: string[] | null = null;
  const bodyRows: { cells: string[]; discrepancy: boolean }[] = [];

  for (const line of lines) {
    const rawCells = splitMarkdownTableCells(line);
    if (!rawCells) continue;
    if (isMarkdownTableSeparatorRow(rawCells)) continue;
    if (!colMap) {
      const m = tryParseVarianceAnalysisHeader(rawCells);
      if (m) {
        colMap = m;
        headerCells = rawCells.map(normalizeMdCell);
      }
      continue;
    }
    const maybeNew = tryParseVarianceAnalysisHeader(rawCells);
    if (maybeNew) {
      colMap = maybeNew;
      headerCells = rawCells.map(normalizeMdCell);
      bodyRows.length = 0;
      continue;
    }
    const cells = rawCells.map(normalizeMdCell);
    while (cells.length < (headerCells?.length ?? 0)) cells.push("");
    const get = (idx: number) => (idx < cells.length ? cells[idx]! : "");
    const status = get(colMap.status);
    const discrepancy = statusIndicatesDiscrepancyRow(status);
    bodyRows.push({ cells, discrepancy });
  }

  if (!colMap || !headerCells) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {source}
      </ReactMarkdown>
    );
  }

  const thClass =
    "border-b border-border px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
  const tdBase = "border-b border-border px-2 py-2 align-top text-foreground";

  return (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead className="bg-muted/50">
          <tr>
            {headerCells.map((h, idx) => (
              <th key={idx} className={thClass}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.length === 0 ? (
            <tr>
              <td
                colSpan={headerCells.length}
                className={cn(tdBase, "text-muted-foreground")}
              >
                No data rows parsed in this section.
              </td>
            </tr>
          ) : (
            bodyRows.map((row, ri) => (
              <tr key={ri}>
                {headerCells.map((_, ci) => {
                  const cell = row.cells[ci] ?? "";
                  const isStatusCol = colMap!.status === ci;
                  const isValueVarCol = colMap!.valueVariance === ci;
                  return (
                    <td
                      key={ci}
                      className={cn(
                        tdBase,
                        isStatusCol && row.discrepancy && "font-bold",
                        isValueVarCol &&
                          row.discrepancy &&
                          "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReportMarkdownWithValidationHighlight({ markdown }: { markdown: string }) {
  const { split, varianceSplit } = useMemo(() => {
    const vr = splitAtValidationResultsSection(markdown);
    const va = vr.validationInner
      ? splitAtVarianceAnalysisSection(vr.after)
      : { before: "", varianceInner: null as string | null, after: "" };
    return { split: vr, varianceSplit: va };
  }, [markdown]);

  if (!split.validationInner) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    );
  }

  const h2Class =
    "mt-6 border-b border-border pb-1 text-base font-semibold tracking-tight first:mt-0";
  const va = varianceSplit;

  return (
    <Fragment>
      {split.before.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {split.before}
        </ReactMarkdown>
      ) : null}
      <h2 className={h2Class}>Validation Results</h2>
      <ValidationResultsSectionTable source={split.validationInner} />
      {va.before.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {va.before}
        </ReactMarkdown>
      ) : null}
      {va.varianceInner ? (
        <>
          <h2 className={h2Class}>Variance Analysis</h2>
          <VarianceAnalysisSectionTable source={va.varianceInner} />
        </>
      ) : null}
      {va.after.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {va.after}
        </ReactMarkdown>
      ) : null}
    </Fragment>
  );
}

export function KognitosRunResultsDialog({
  run,
  open,
  onOpenChange,
}: {
  run: KognitosDashboardRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const runId = run?.id ?? null;
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setPayload(null);
    try {
      const res = await fetch(
        `/api/kognitos/runs/${encodeURIComponent(id)}/payload`,
      );
      const json = (await res.json()) as {
        payload?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setError(
          json.error ??
            (res.status === 404
              ? "Run payload was not found."
              : "Could not load run payload."),
        );
        return;
      }
      if (!json.payload || typeof json.payload !== "object" || Array.isArray(json.payload)) {
        setError("Run has no payload object.");
        return;
      }
      setPayload(json.payload as Record<string, unknown>);
    } catch {
      setError("Could not load run payload.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !runId) {
      setPayload(null);
      setError(null);
      return;
    }
    void load(runId);
  }, [open, runId, load]);

  const merged = payload ? mergeRunOutputs(payload) : null;
  const markdown =
    merged && Object.keys(merged).length > 0
      ? markdownReportTextFromOutputs(merged) ?? ""
      : "";

  const fallbackLines =
    merged && !markdown
      ? [
          pickMergedString(merged, [
            "payment_recommendation",
            "paymentRecommendation",
          ]),
          pickMergedString(merged, ["payment_status", "paymentStatus"]),
          pickMergedString(merged, ["status", "workflow_status", "workflowStatus"]),
        ].filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];

  const titleFromMarkdown =
    markdown && /SAP\s+4[\s-]*Way\s+Match/i.test(markdown)
      ? "SAP 4-Way Match Validation Report"
      : "Run results";

  const displayMarkdown = markdown
    ? limitFractionDigitsInReportMarkdown(markdown)
    : "";
  const displayFallbackLines = fallbackLines.map((line) =>
    limitFractionDigitsInReportMarkdown(line),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(90vh,880px)] w-[min(96vw,52rem)] max-w-[min(96vw,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,52rem)]"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {titleFromMarkdown}
          </DialogTitle>
          {run ? (
            <DialogDescription className="text-sm">
              {run.vendor} · Invoice / ID {run.invoiceNumber}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading report…</p>
          ) : error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : markdown ? (
            <div
              className={cn(
                "text-foreground [&_a]:text-emerald-700 [&_a]:underline dark:[&_a]:text-emerald-400",
              )}
            >
              <ReportMarkdownWithValidationHighlight markdown={displayMarkdown} />
            </div>
          ) : fallbackLines.length > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-foreground">Output summary</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {displayFallbackLines.map((line, i) => (
                  <li key={`fb-${i}-${line.slice(0, 48)}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No markdown report or summary fields were found in this run&apos;s
              stored output. Use the Kognitos app link (eye icon) to open the full
              run if available.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
