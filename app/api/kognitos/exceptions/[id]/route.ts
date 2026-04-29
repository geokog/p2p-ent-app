import { NextResponse } from "next/server";

import {
  buildExceptionRunContext,
  mapExceptionToDetail,
  mapListEventsResponse,
  type ExceptionDetailBundleDto,
} from "@/lib/kognitos/exception-view-model";
import {
  automationShortIdFromAutomationResourceName,
  runShortIdFromRunResourceName,
} from "@/lib/kognitos/kognitos-resource-ids";
import { getKognitosAutomationRunResultsUrl } from "@/lib/kognitos/automation-details-url";
import {
  getWorkspaceException,
  listExceptionResolutionEvents,
} from "@/lib/kognitos/workspace-exceptions-api";
import { supabaseAdmin } from "@/lib/supabase";

function kognitosEnvReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!kognitosEnvReady()) {
    return NextResponse.json({ error: "kognitos_env_missing" }, { status: 503 });
  }

  const { id } = await context.params;
  const exceptionId = decodeURIComponent(id ?? "").trim();
  if (!exceptionId) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  let excRaw: Record<string, unknown>;
  try {
    excRaw = await getWorkspaceException(exceptionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const automationDisplayNameByAutomationId = new Map<string, string>();
  if (supabaseAdmin) {
    const { data: autos } = await supabaseAdmin
      .from("kognitos_automations")
      .select("automation_id, display_name");
    for (const a of autos ?? []) {
      const row = a as { automation_id?: string; display_name?: string };
      const ext = String(row.automation_id ?? "").trim();
      const name = String(row.display_name ?? "").trim();
      if (ext && name) automationDisplayNameByAutomationId.set(ext, name);
    }
  }

  const detail = mapExceptionToDetail(excRaw, automationDisplayNameByAutomationId);
  if (!detail) {
    return NextResponse.json({ error: "invalid_exception_payload" }, { status: 502 });
  }

  const runRes = detail.runResource;
  const autoRes = detail.automationResource;
  const runId = runRes ? runShortIdFromRunResourceName(runRes) : null;
  const automationId = autoRes
    ? automationShortIdFromAutomationResourceName(autoRes)
    : null;

  let payload: Record<string, unknown> | null = null;
  let automationDisplayName: string | null = null;
  if (supabaseAdmin && runId) {
    const { data: runRow } = await supabaseAdmin
      .from("kognitos_runs")
      .select("payload, kognitos_automation_id")
      .eq("id", runId)
      .maybeSingle();
    if (runRow?.payload && typeof runRow.payload === "object" && !Array.isArray(runRow.payload)) {
      payload = runRow.payload as Record<string, unknown>;
    }
    const autoUuid = runRow?.kognitos_automation_id as string | undefined;
    if (autoUuid) {
      const { data: autoRow } = await supabaseAdmin
        .from("kognitos_automations")
        .select("display_name")
        .eq("id", autoUuid)
        .maybeSingle();
      const dn = (autoRow as { display_name?: string } | null)?.display_name;
      if (typeof dn === "string" && dn.trim()) automationDisplayName = dn.trim();
    }
  }

  let eventsRaw: Record<string, unknown> = { events: [] };
  let eventsAgentIdUsed: string | null = null;
  if (automationId && runId) {
    try {
      const { raw, agentIdUsed } = await listExceptionResolutionEvents({
        automationId,
        runId,
        exceptionIdShort: detail.exceptionId,
        pageSize: 50,
      });
      eventsRaw = raw;
      eventsAgentIdUsed = agentIdUsed;
    } catch {
      eventsRaw = { events: [] };
      eventsAgentIdUsed = null;
    }
  }

  const runContext = buildExceptionRunContext({
    runId,
    payload,
    automationDisplayName,
  });

  const kognitosRunUrl =
    automationId && runId
      ? getKognitosAutomationRunResultsUrl(automationId, runId)
      : null;

  const bundle: ExceptionDetailBundleDto = {
    exception: detail,
    events: mapListEventsResponse(eventsRaw),
    runContext,
    eventsAgentIdUsed,
    kognitosRunUrl,
  };

  return NextResponse.json(bundle);
}
