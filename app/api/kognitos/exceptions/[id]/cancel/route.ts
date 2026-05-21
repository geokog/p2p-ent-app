import { NextResponse } from "next/server";

import { KognitosApiError } from "@/lib/kognitos/client-core";
import {
  automationResourceStringFromExceptionRaw,
  runResourceStringFromExceptionRaw,
} from "@/lib/kognitos/exception-raw-resource-strings";
import {
  automationShortIdFromAutomationResourceName,
  runShortIdFromRunResourceName,
} from "@/lib/kognitos/kognitos-resource-ids";
import {
  getWorkspaceException,
  resolveAgentIdForExceptionReply,
} from "@/lib/kognitos/workspace-exceptions-api";
import { cancelExceptionGeneration } from "@/lib/kognitos/exception-stream-server";

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
 * POST `/api/kognitos/exceptions/[id]/cancel` — proxies Kognitos
 * `CancelGeneration` for the exception's resolution agent thread, used
 * by the Stop button when the agent is mid-stream.
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

  const agentId = await resolveAgentIdForExceptionReply({
    excRaw,
    automationId,
    runId,
    exceptionIdShort: exceptionId,
  });
  if (!agentId) {
    return NextResponse.json(
      { error: "agent_id_unresolved" },
      { status: 422 },
    );
  }

  try {
    await cancelExceptionGeneration({ automationId, runId, agentId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof KognitosApiError) {
      return NextResponse.json(
        {
          error: e.message,
          code: "kognitos_api_error",
          kognitosStatus: e.status,
          bodySnippet: e.bodySnippet?.slice(0, 600),
        },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
      );
    }
    const msg = e instanceof Error ? e.message : "cancel_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
