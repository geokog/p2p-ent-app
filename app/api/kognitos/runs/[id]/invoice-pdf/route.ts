import { NextResponse } from "next/server";

import { downloadOrganizationFile } from "@/lib/kognitos/client-core";
import { kognitosFileDownloadIdVariants } from "@/lib/kognitos/extract-run-input-files";
import { supplierInvoiceDocNumberFromOutputs } from "@/lib/kognitos/markdown-report-supplier-invoice";
import {
  isKognitosFileDownloadConfigured,
  listInvoicePdfFileIdCandidatesFromRun,
  type RunInputFileRow,
} from "@/lib/kognitos/resolve-invoice-pdf-file-id";
import { mergeKognitosRunOutputLayers } from "@/lib/kognitos/validation-from-automation-output";
import { supabaseAdmin } from "@/lib/supabase";

/** Large PDFs from Kognitos; allow time for upstream + buffering on Vercel. */
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing" },
      { status: 503 },
    );
  }
  if (!isKognitosFileDownloadConfigured()) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }

  const { data: row, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("payload")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const payload =
    row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  const { data: inputRows, error: inErr } = await supabaseAdmin
    .from("kognitos_run_inputs")
    .select("kognitos_file_id, file_name, input_key")
    .eq("kognitos_run_id", id);

  if (inErr) {
    return NextResponse.json({ error: inErr.message }, { status: 500 });
  }

  const rows: RunInputFileRow[] = (inputRows ?? []).map((raw) => {
    const r = raw as {
      kognitos_file_id?: string;
      file_name?: string | null;
      input_key?: string;
    };
    return {
      kognitos_file_id: String(r.kognitos_file_id ?? ""),
      file_name:
        typeof r.file_name === "string" || r.file_name === null
          ? r.file_name
          : null,
      input_key: String(r.input_key ?? ""),
    };
  });

  const fileIds = listInvoicePdfFileIdCandidatesFromRun(payload, rows);
  if (fileIds.length === 0) {
    return NextResponse.json({ error: "invoice_pdf_not_found" }, { status: 404 });
  }

  const supplierInvoiceFromMarkdown = supplierInvoiceDocNumberFromOutputs(
    mergeKognitosRunOutputLayers(payload),
  );
  const firstCandidateVariants = kognitosFileDownloadIdVariants(fileIds[0] ?? "");

  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b999a8",
    },
    body: JSON.stringify({
      sessionId: "b999a8",
      hypothesisId: "H4",
      location: "invoice-pdf/route.ts:candidates",
      message: "invoice_pdf_file_id_candidates",
      data: {
        runId: id,
        supplierInvoiceMarkdown: supplierInvoiceFromMarkdown ?? null,
        candidateCount: fileIds.length,
        idPrefixes: fileIds.map((fid) => fid.slice(0, 16)),
        firstCandidateVariantSuffixes: firstCandidateVariants.map((v) =>
          v.length > 48 ? `…${v.slice(-48)}` : v,
        ),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  let lastError = "download_failed";
  let everyAttemptWasKognitos404 = true;
  for (const fileId of fileIds) {
    for (const downloadId of kognitosFileDownloadIdVariants(fileId)) {
      try {
        const upstream = await downloadOrganizationFile(downloadId);
        const buf = await upstream.arrayBuffer();
        if (buf.byteLength === 0) {
          everyAttemptWasKognitos404 = false;
          // #region agent log
          fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "b999a8",
            },
            body: JSON.stringify({
              sessionId: "b999a8",
              hypothesisId: "H2",
              location: "invoice-pdf/route.ts:empty_body",
              message: "upstream_pdf_empty_buffer",
              data: {
                runId: id,
                fileIdPrefix: downloadId.slice(0, 16),
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          lastError = "empty_response_body";
          continue;
        }
        const headers = new Headers();
        const ct = upstream.headers.get("content-type");
        headers.set("Content-Type", ct && ct.trim() ? ct : "application/pdf");
        headers.set("Content-Disposition", 'inline; filename="invoice.pdf"');
        headers.set("Cache-Control", "private, max-age=120");
        // #region agent log
        fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "b999a8",
          },
          body: JSON.stringify({
            sessionId: "b999a8",
            hypothesisId: "verify",
            location: "invoice-pdf/route.ts:success",
            message: "invoice_pdf_download_ok",
            data: {
              runId: id,
              usedVariantPrefix: downloadId.slice(0, 24),
              bytes: buf.byteLength,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return new NextResponse(buf, { status: 200, headers });
      } catch (e) {
        lastError = e instanceof Error ? e.message : "download_failed";
        if (!/^Kognitos download 404\b/.test(lastError)) {
          everyAttemptWasKognitos404 = false;
        }
        // #region agent log
        fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "b999a8",
          },
          body: JSON.stringify({
            sessionId: "b999a8",
            hypothesisId: "H1",
            location: "invoice-pdf/route.ts:catch",
            message: "download_attempt_failed",
            data: {
              runId: id,
              fileIdPrefix: downloadId.slice(0, 16),
              errPreview: lastError.slice(0, 500),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }
    }
  }

  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b999a8",
    },
    body: JSON.stringify({
      sessionId: "b999a8",
      hypothesisId: "H5",
      location: "invoice-pdf/route.ts:exhausted",
      message: everyAttemptWasKognitos404
        ? "all_candidates_exhausted_404_upstream"
        : "all_candidates_exhausted_502",
      data: {
        runId: id,
        everyAttemptWasKognitos404,
        lastErrorPreview: lastError.slice(0, 500),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (everyAttemptWasKognitos404) {
    return NextResponse.json(
      {
        error: "invoice_pdf_not_found_upstream",
        detail: lastError.slice(0, 800),
        hint: "Kognitos has no org file for the resolved id(s). Re-sync the run (e.g. npm run refresh:run-payloads) or confirm the file still exists in Kognitos.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ error: lastError }, { status: 502 });
}
