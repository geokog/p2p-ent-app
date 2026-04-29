import { NextResponse } from "next/server";

import {
  isKognitosFileDownloadConfigured,
  type RunInputFileRow,
} from "@/lib/kognitos/resolve-invoice-pdf-file-id";
import { resolveRunOutputDocumentUrl } from "@/lib/kognitos/run-output-document-url";
import { supabaseAdmin } from "@/lib/supabase";

/** Test page only resolves documents for this run (narrow surface). */
const ALLOWED_RUN_ID = "5cO1tlyJvQa8bSgnsWLE1";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (id !== ALLOWED_RUN_ID) {
    return NextResponse.json({ error: "unsupported_run_id" }, { status: 403 });
  }
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

  const { data: row, error: rowErr } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, kognitos_automation_id")
    .eq("id", id)
    .maybeSingle();

  if (rowErr) {
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "run_not_in_db" }, { status: 404 });
  }

  const autoUuid = row.kognitos_automation_id as string | null;
  let automationExternalId: string | undefined;
  if (autoUuid?.trim()) {
    const { data: auto } = await supabaseAdmin
      .from("kognitos_automations")
      .select("automation_id")
      .eq("id", autoUuid)
      .maybeSingle();
    const ext = auto?.automation_id;
    if (typeof ext === "string" && ext.trim()) {
      automationExternalId = ext.trim();
    }
  }

  const { data: inputRowsRaw, error: inErr } = await supabaseAdmin
    .from("kognitos_run_inputs")
    .select("kognitos_file_id, file_name, input_key")
    .eq("kognitos_run_id", id);

  if (inErr) {
    return NextResponse.json({ error: inErr.message }, { status: 500 });
  }

  const inputRows: RunInputFileRow[] = (inputRowsRaw ?? []).map((raw) => {
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

  try {
    const resolved = await resolveRunOutputDocumentUrl(
      id,
      automationExternalId,
      inputRows,
    );
    return NextResponse.json({
      url: resolved.url,
      kind: resolved.kind,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "resolution_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
