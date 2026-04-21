/**
 * SAP-style markdown reports store tables in
 * `state.completed.outputs.markdown_report.text`. A row whose first cell is
 * exactly `Supplier Invoice` carries the document number in the second cell.
 */

/** Split a markdown pipe row into trimmed cells. */
export function splitMarkdownTableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const core = t.endsWith("|") ? t.slice(1, -1) : t.slice(1);
  return core.split("|").map((c) => c.trim());
}

export function isMarkdownTableSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => {
    const x = c.replace(/\s/g, "");
    return x === "" || /^-+$/.test(x);
  });
}

/** SAP FI/MM document numbers in this flow are numeric (e.g. 5100001685). Skips header rows like `| Supplier Invoice | Material |`. */
function looksLikeSapNumericDocId(s: string): boolean {
  const x = s.trim().replace(/,/g, "");
  return /^\d{4,15}$/.test(x);
}

function markdownReportTextFromField(report: unknown): string | undefined {
  if (typeof report === "string" && report.trim()) return report.trim();
  if (!report || typeof report !== "object" || Array.isArray(report))
    return undefined;
  const o = report as Record<string, unknown>;
  const candidates = [o.text, o.markdown, o.body, o.content];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object" && !Array.isArray(c)) {
      const inner = c as Record<string, unknown>;
      if (typeof inner.stringValue === "string" && inner.stringValue.trim()) {
        return inner.stringValue.trim();
      }
      if (typeof inner.string_value === "string" && inner.string_value.trim()) {
        return inner.string_value.trim();
      }
    }
  }
  return undefined;
}

/**
 * Scan markdown for a table row whose first column is exactly `Supplier Invoice`
 * and return the second column when it looks like a numeric document id.
 */
export function supplierInvoiceDocNumberFromMarkdownReportText(
  markdown: string,
): string | undefined {
  if (!markdown || typeof markdown !== "string") return undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const cells = splitMarkdownTableCells(line);
    if (!cells || cells.length < 2) continue;
    if (isMarkdownTableSeparatorRow(cells)) continue;
    if (cells[0] !== "Supplier Invoice") continue;
    const doc = (cells[1] ?? "").trim().replace(/,/g, "");
    if (!looksLikeSapNumericDocId(doc)) continue;
    return doc;
  }
  return undefined;
}

/** Plain-text body of `markdown_report` / `markdownReport` on merged outputs. */
export function markdownReportTextFromOutputs(
  outputs: Record<string, unknown>,
): string | undefined {
  const mr = outputs.markdown_report ?? outputs.markdownReport;
  return markdownReportTextFromField(mr);
}

/** Resolve supplier invoice id from `markdown_report` in merged outputs. */
export function supplierInvoiceDocNumberFromOutputs(
  outputs: Record<string, unknown>,
): string | undefined {
  const text = markdownReportTextFromOutputs(outputs);
  if (!text) return undefined;
  return supplierInvoiceDocNumberFromMarkdownReportText(text);
}
