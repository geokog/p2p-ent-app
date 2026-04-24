import { NextResponse } from "next/server";

import { downloadOrganizationFile } from "@/lib/kognitos/client-core";
import {
  isKognitosFileDownloadConfigured,
  listInvoicePdfFileIdCandidatesFromRun,
  type RunInputFileRow,
} from "@/lib/kognitos/resolve-invoice-pdf-file-id";
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

  let lastError = "download_failed";
  for (const fileId of fileIds) {
    try {
      const upstream = await downloadOrganizationFile(fileId);
      const buf = await upstream.arrayBuffer();
      if (buf.byteLength === 0) {
        lastError = "empty_response_body";
        continue;
      }
      const headers = new Headers();
      const ct = upstream.headers.get("content-type");
      headers.set("Content-Type", ct && ct.trim() ? ct : "application/pdf");
      headers.set("Content-Disposition", 'inline; filename="invoice.pdf"');
      headers.set("Cache-Control", "private, max-age=120");
      return new NextResponse(buf, { status: 200, headers });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "download_failed";
    }
  }

  return NextResponse.json({ error: lastError }, { status: 502 });
}
