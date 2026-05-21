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
import { openExceptionEventStream } from "@/lib/kognitos/exception-stream-server";

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
 * GET `/api/kognitos/exceptions/[id]/stream` — NDJSON proxy of Kognitos
 * `StreamEvents` for the exception's agent thread.
 *
 * Behavior:
 *   - Resolves the exception's automation/run/agent ids from the workspace
 *     (same path the polling and reply routes already use).
 *   - Opens the upstream NDJSON stream and forwards bytes verbatim so the
 *     browser sees `application/x-ndjson` line-delimited events.
 *   - Caller cancellation propagates upstream via the request `signal`.
 */
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
      { error: "agent_id_unresolved", code: "agent_id_unresolved" },
      { status: 422 },
    );
  }

  let upstream: Response;
  try {
    upstream = await openExceptionEventStream({
      automationId,
      runId,
      agentId,
      signal: request.signal,
    });
  } catch (e) {
    if (e instanceof KognitosApiError) {
      return NextResponse.json(
        {
          error: e.message,
          code: "kognitos_api_error",
          kognitosStatus: e.status,
          bodySnippet: e.bodySnippet?.slice(0, 800),
        },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
      );
    }
    const msg = e instanceof Error ? e.message : "kognitos_stream_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!upstream.body) {
    return NextResponse.json({ error: "kognitos_empty_stream" }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Kognitos-Agent-Id": agentId,
    },
  });
}
