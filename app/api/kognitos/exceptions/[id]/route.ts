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
  automationResourceStringFromExceptionRaw,
  runResourceStringFromExceptionRaw,
} from "@/lib/kognitos/exception-raw-resource-strings";
import {
  devDiagnoseAgentScopedListEvents,
  getWorkspaceException,
  listExceptionResolutionEvents,
} from "@/lib/kognitos/workspace-exceptions-api";
import { supabaseAdmin } from "@/lib/supabase";

const IS_DEV = process.env.NODE_ENV === "development";

/** Dev-only: log string-ish raw fields; avoid dumping full `excRaw` (unknown extra keys). */
function devPickRawString(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function kognitosEnvReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}

export async function GET(
  request: Request,
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
  const url = new URL(request.url);
  const includeRawDebug =
    url.searchParams.get("debug") === "1" &&
    (IS_DEV || process.env.KOGNITOS_ALLOW_RAW_DEBUG_RESPONSE === "1");

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

  if (IS_DEV) {
    const runFromHelpers = runResourceStringFromExceptionRaw(excRaw) ?? null;
    const autoFromHelpers = automationResourceStringFromExceptionRaw(excRaw) ?? null;
    console.log(
      "[kognitos][dev][List Events path validation] OpenAPI in this repo documents operationId ListEvents as GET …/automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events. The app now uses that agent-scoped path as primary and keeps GET …/automations/…/runs/…/exceptions/{exception_id}/events as a transition fallback.",
    );
    console.log(
      "[kognitos][dev][exception raw → List Events IDs]",
      JSON.stringify(
        {
          successfulPriorCall: {
            operation:
              "GET /api/v1/organizations/{org}/workspaces/{ws}/exceptions/{exception_id}",
            exceptionIdFromRoute: exceptionId,
            note: "Same org/workspace as List Events; uses route param as exception id.",
          },
          listEventsCallWillUse: {
            pathTemplate:
              "GET …/automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events?page_size=50",
            fallbackPathTemplate:
              "GET …/automations/{automation_id}/runs/{run_id}/exceptions/{exception_id}/events?page_size=50",
            automationId,
            runId,
            exceptionIdShort: detail.exceptionId,
          },
          rawStringFieldsUsedForDerivation: {
            name: devPickRawString(excRaw, "name"),
            exception: devPickRawString(excRaw, "exception"),
            exception_id: devPickRawString(excRaw, "exception_id"),
            exceptionId: devPickRawString(excRaw, "exceptionId"),
            run: devPickRawString(excRaw, "run"),
            run_name: devPickRawString(excRaw, "run_name"),
            automation: devPickRawString(excRaw, "automation"),
            assignee: devPickRawString(excRaw, "assignee"),
            resolver: devPickRawString(excRaw, "resolver"),
            execution_id: devPickRawString(excRaw, "execution_id"),
            executionId: devPickRawString(excRaw, "executionId"),
          },
          helperExtractedResources: {
            runResourceStringFromExceptionRaw: runFromHelpers,
            automationResourceStringFromExceptionRaw: autoFromHelpers,
          },
          mappedDetailResources: {
            exceptionResourceName: detail.exceptionResourceName,
            runResource: detail.runResource,
            automationResource: detail.automationResource,
            detailExceptionId: detail.exceptionId,
          },
        },
        null,
        2,
      ),
    );
  }

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
        excRaw,
        pageSize: 50,
      });
      eventsRaw = raw;
      eventsAgentIdUsed = agentIdUsed;
    } catch (e) {
      eventsRaw = { events: [] };
      eventsAgentIdUsed = null;
      if (IS_DEV) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(
          "[kognitos][dev] listExceptionResolutionEvents failed",
          JSON.stringify(
            {
              exceptionIdFromRoute: exceptionId,
              automationId,
              runId,
              exceptionIdShortForListEvents: detail.exceptionId,
              pageSize: 50,
              primaryKognitosRelativePath:
                "GET …/automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events?page_size=50",
              fallbackKognitosRelativePath: `GET …/automations/${automationId}/runs/${runId}/exceptions/${detail.exceptionId}/events?page_size=50`,
              error: errMsg,
            },
            null,
            2,
          ),
        );
      }
    }
  }

  if (IS_DEV && automationId && runId) {
    await devDiagnoseAgentScopedListEvents({
      exceptionId,
      excRaw,
      automationId,
      runId,
    });
  }

  if (IS_DEV) {
    console.log(
      "[kognitos][dev] List Events context (before mapListEventsResponse)",
      JSON.stringify(
        {
          "1_exceptionIdFromRoute": exceptionId,
          "2_automationId": automationId,
          "3_runId": runId,
          "4_exceptionIdShortForListEvents": detail.exceptionId,
          "5_eventsAgentIdInferredFromFirstEvent": eventsAgentIdUsed,
          "5b_exceptionAssigneeShort": detail.assigneeShort,
        },
        null,
        2,
      ),
    );
    console.log(
      "[kognitos][dev] List Events raw response (6) JSON.stringify(eventsRaw, null, 2):\n",
      JSON.stringify(eventsRaw, null, 2),
    );
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

  const responseBody: ExceptionDetailBundleDto & {
    rawKognitosDebug?: {
      note: string;
      exceptionRaw: Record<string, unknown>;
      eventsRaw: Record<string, unknown>;
    };
  } = includeRawDebug
    ? {
        ...bundle,
        rawKognitosDebug: {
          note:
            "Included only for ?debug=1 when NODE_ENV=development or KOGNITOS_ALLOW_RAW_DEBUG_RESPONSE=1.",
          exceptionRaw: excRaw,
          eventsRaw,
        },
      }
    : bundle;

  return NextResponse.json(responseBody);
}
