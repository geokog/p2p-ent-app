import { NextResponse } from "next/server";

import { getKognitosAutomationRunResultsUrl } from "@/lib/kognitos/automation-details-url";
import {
  enrichDashboardRunWithRequest,
  normalizeKognitosRowForDashboard,
} from "@/lib/kognitos/normalize-dashboard-run";
import {
  isKognitosFileDownloadConfigured,
  resolveInvoicePdfFileIdFromRun,
  type RunInputFileRow,
} from "@/lib/kognitos/resolve-invoice-pdf-file-id";
import { getRequestIdFromRunPayload } from "@/lib/kognitos/run-payload";
import { supabaseAdmin } from "@/lib/supabase";

const MAX_ROWS = 500;

const REQUEST_SELECT =
  "id, estimated_value, title, category, kognitos_run_id" as const;

type RequestRow = {
  id: string;
  estimated_value: unknown;
  title: string;
  category: string;
  kognitos_run_id: string | null;
};

function addRequestMaps(
  rows: RequestRow[],
  byId: Map<string, RequestRow>,
  byRunId: Map<string, RequestRow>,
) {
  for (const r of rows) {
    byId.set(String(r.id), r);
    if (r.kognitos_run_id != null && String(r.kognitos_run_id).trim()) {
      byRunId.set(String(r.kognitos_run_id), r);
    }
  }
}

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing", runs: [] },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, payload, update_time, create_time, kognitos_automation_id")
    .order("update_time", { ascending: false, nullsFirst: false })
    .order("create_time", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const runIds = [...new Set(rows.map((r) => String(r.id)))];

  const requestIds = new Set<string>();
  for (const row of rows) {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const rid = getRequestIdFromRunPayload(payload);
    if (rid) requestIds.add(rid);
  }

  const requestById = new Map<string, RequestRow>();
  const requestByRunId = new Map<string, RequestRow>();

  const automationIds = [
    ...new Set(
      rows
        .map((r) => r.kognitos_automation_id as string | null | undefined)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  /** Internal automation row UUID → Kognitos `automation_id` (used in app URLs and API paths). */
  const automationExternalIdByUuid = new Map<string, string>();
  const automationNameById = new Map<string, string>();
  if (automationIds.length > 0) {
    const { data: autos, error: autoErr } = await supabaseAdmin
      .from("kognitos_automations")
      .select("id, automation_id, display_name")
      .in("id", automationIds);
    if (!autoErr && autos) {
      for (const a of autos) {
        const row = a as {
          id: string;
          automation_id?: string;
          display_name?: string;
        };
        const ext = String(row.automation_id ?? "").trim();
        if (ext) automationExternalIdByUuid.set(String(row.id), ext);
        const name = String(row.display_name ?? "").trim();
        if (name) automationNameById.set(String(row.id), name);
      }
    }
  }

  if (requestIds.size > 0) {
    const { data: reqs, error: reqErr } = await supabaseAdmin
      .from("requests")
      .select(REQUEST_SELECT)
      .in("id", [...requestIds]);
    if (!reqErr && reqs) addRequestMaps(reqs as RequestRow[], requestById, requestByRunId);
  }

  if (runIds.length > 0) {
    const { data: byRun, error: runErr } = await supabaseAdmin
      .from("requests")
      .select(REQUEST_SELECT)
      .in("kognitos_run_id", runIds);
    if (!runErr && byRun) addRequestMaps(byRun as RequestRow[], requestById, requestByRunId);
  }

  const inputsByRunId = new Map<string, RunInputFileRow[]>();
  if (runIds.length > 0) {
    const { data: inputRows, error: inErr } = await supabaseAdmin
      .from("kognitos_run_inputs")
      .select("kognitos_run_id, kognitos_file_id, file_name, input_key")
      .in("kognitos_run_id", runIds);
    if (!inErr && inputRows) {
      for (const raw of inputRows) {
        const r = raw as {
          kognitos_run_id?: string;
          kognitos_file_id?: string;
          file_name?: string | null;
          input_key?: string;
        };
        const rid = String(r.kognitos_run_id ?? "");
        if (!rid) continue;
        const row: RunInputFileRow = {
          kognitos_file_id: String(r.kognitos_file_id ?? ""),
          file_name:
            typeof r.file_name === "string" || r.file_name === null
              ? r.file_name
              : null,
          input_key: String(r.input_key ?? ""),
        };
        const list = inputsByRunId.get(rid) ?? [];
        list.push(row);
        inputsByRunId.set(rid, list);
      }
    }
  }

  const kognitosPdf = isKognitosFileDownloadConfigured();

  const runs = rows.map((row) => {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const autoId = row.kognitos_automation_id as string | null | undefined;
    const normalized = normalizeKognitosRowForDashboard({
      id: String(row.id),
      payload: row.payload,
      update_time:
        typeof row.update_time === "string"
          ? row.update_time
          : row.update_time != null
            ? String(row.update_time)
            : null,
      create_time:
        typeof row.create_time === "string"
          ? row.create_time
          : row.create_time != null
            ? String(row.create_time)
            : null,
      automation_display_name:
        autoId != null ? automationNameById.get(String(autoId)) ?? null : null,
    });
    const rid = getRequestIdFromRunPayload(payload);
    const req =
      (rid ? requestById.get(rid) : undefined) ??
      requestByRunId.get(String(row.id)) ??
      undefined;
    const kognitosAutomationUrlId =
      autoId != null
        ? automationExternalIdByUuid.get(String(autoId)) ?? null
        : null;
    const kognitosRunUrl =
      kognitosAutomationUrlId != null
        ? getKognitosAutomationRunResultsUrl(kognitosAutomationUrlId, String(row.id))
        : null;
    const inputList = inputsByRunId.get(String(row.id)) ?? [];
    const hasPdf =
      kognitosPdf &&
      Boolean(resolveInvoicePdfFileIdFromRun(payload, inputList));
    const invoicePdfUrl = hasPdf
      ? `/api/kognitos/runs/${encodeURIComponent(String(row.id))}/invoice-pdf`
      : null;
    return enrichDashboardRunWithRequest(
      { ...normalized, kognitosRunUrl, invoicePdfUrl },
      req,
    );
  });

  return NextResponse.json({ runs });
}
