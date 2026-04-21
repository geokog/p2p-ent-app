import {
  extractFileRefsFromKognitosPayload,
  normalizeKognitosFileIdForDownload,
} from "@/lib/kognitos/extract-run-input-files";

export type RunInputFileRow = {
  kognitos_file_id: string;
  file_name: string | null;
  input_key: string;
};

const INVOICE_HINT =
  /invoice|vendor_bill|supplier|ap_invoice|document|upload|bill|receipt|grn/i;
const PDF_NAME = /\.pdf$/i;

function scoreInputRow(r: RunInputFileRow): number {
  const id = (r.kognitos_file_id ?? "").trim();
  if (!id || /^https?:\/\//i.test(id)) return -1;
  const name = (r.file_name ?? "").trim();
  const key = (r.input_key ?? "").trim();
  let s = 0;
  if (PDF_NAME.test(name)) s += 10;
  if (INVOICE_HINT.test(key)) s += 5;
  if (INVOICE_HINT.test(name)) s += 3;
  return s;
}

/**
 * Pick a Kognitos org file id suitable for downloading the invoice PDF for a run.
 * Prefers indexed `kognitos_run_inputs` rows (PDF name + invoice-ish input keys),
 * then file refs embedded in the raw `payload`.
 */
export function resolveInvoicePdfFileIdFromRun(
  payload: Record<string, unknown>,
  inputRows: RunInputFileRow[],
): string | null {
  const rows = inputRows.filter((r) => {
    const id = (r.kognitos_file_id ?? "").trim();
    return Boolean(id) && !/^https?:\/\//i.test(id);
  });
  if (rows.length > 0) {
    const scored = rows
      .map((r) => ({ r, s: scoreInputRow(r) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.r.input_key.localeCompare(b.r.input_key));
    if (scored.length > 0) return scored[0]!.r.kognitos_file_id.trim();
  }

  const refs = extractFileRefsFromKognitosPayload(payload);
  for (const ref of refs) {
    if (!ref.remote || /^https?:\/\//i.test(ref.remote)) continue;
    const fid = normalizeKognitosFileIdForDownload(ref.remote);
    if (!fid || /^https?:\/\//i.test(fid)) continue;
    const fn = ref.inlineFileName ?? "";
    if (PDF_NAME.test(fn) || INVOICE_HINT.test(ref.inputKey)) return fid;
  }
  for (const ref of refs) {
    if (!ref.remote || /^https?:\/\//i.test(ref.remote)) continue;
    const fid = normalizeKognitosFileIdForDownload(ref.remote);
    if (fid && !/^https?:\/\//i.test(fid)) return fid;
  }
  return null;
}

export function isKognitosFileDownloadConfigured(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}
