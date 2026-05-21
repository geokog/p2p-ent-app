import { NextResponse } from "next/server";

import { KognitosApiError, continueRun } from "@/lib/kognitos/client-core";
import {
  automationResourceStringFromExceptionRaw,
  runResourceStringFromExceptionRaw,
} from "@/lib/kognitos/exception-raw-resource-strings";
import {
  automationShortIdFromAutomationResourceName,
  runShortIdFromRunResourceName,
} from "@/lib/kognitos/kognitos-resource-ids";
import { getWorkspaceException } from "@/lib/kognitos/workspace-exceptions-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function kognitosEnvReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}

/**
 * POST `/api/kognitos/exceptions/[id]/continue-run` — proxies Kognitos
 * `ContinueRun` for the run that owns this exception.
 *
 * Used by the v2 topbar **Run** button when an exception's run is in the
 * `awaiting_guidance` state and the operator wants to resume execution
 * without (or after) sending a reply through the chat. The action does
 * not mutate the exception itself; downstream resolution is still the
 * agent's responsibility.
 */
export async function POST(
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
    const err = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: err }, { status: 502 });
  }

  const runRes = runResourceStringFromExceptionRaw(excRaw) ?? "";
  const autoRes = automationResourceStringFromExceptionRaw(excRaw) ?? "";
  const runId = runRes ? runShortIdFromRunResourceName(runRes) : null;
  const automationId = autoRes
    ? automationShortIdFromAutomationResourceName(autoRes)
    : null;
  if (!runId || !automationId) {
    return NextResponse.json(
      { error: "exception_missing_run_or_automation" },
      { status: 422 },
    );
  }

  try {
    const run = await continueRun(runId, automationId);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    if (e instanceof KognitosApiError) {
      return NextResponse.json(
        {
          error: e.message,
          code: "kognitos_api_error",
          kognitosStatus: e.status,
          bodySnippet: e.bodySnippet?.slice(0, 600),
          hint:
            e.status === 409 || e.status === 400
              ? "The run may not be in a continueable state (only paused / awaiting-guidance runs can be resumed)."
              : undefined,
        },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
      );
    }
    const msg = e instanceof Error ? e.message : "continue_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
