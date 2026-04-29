import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

import {
  automationResourceStringFromExceptionRaw,
  runResourceStringFromExceptionRaw,
} from "@/lib/kognitos/exception-raw-resource-strings";
import {
  automationShortIdFromAutomationResourceName,
  runShortIdFromRunResourceName,
} from "@/lib/kognitos/kognitos-resource-ids";
import { KognitosApiError } from "@/lib/kognitos/client-core";
import {
  getWorkspaceException,
  replyToWorkspaceException,
} from "@/lib/kognitos/workspace-exceptions-api";
async function appendDebugSessionLine(payload: Record<string, unknown>) {
  try {
    await appendFile(
      join(process.cwd(), ".cursor", "debug-b999a8.log"),
      `${JSON.stringify({
        sessionId: "b999a8",
        timestamp: Date.now(),
        ...payload,
      })}\n`,
    );
  } catch {
    /* ignore */
  }
}

function kognitosEnvReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}

export async function POST(
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const msg =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message.trim()
      : "";
  if (!msg) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
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

  const exceptionRef =
    typeof excRaw.name === "string" && excRaw.name.trim()
      ? excRaw.name.trim()
      : exceptionId;

  try {
    await replyToWorkspaceException({
      automationId,
      runId,
      message: msg,
      exceptionId: exceptionRef,
    });
    await appendDebugSessionLine({
      location: "exceptions/[id]/reply/route.ts:success",
      message: "exception_reply_ok",
      data: { exceptionIdLen: exceptionId.length },
    });
  } catch (e) {
    await appendDebugSessionLine({
      location: "exceptions/[id]/reply/route.ts:catch",
      message: "exception_reply_error",
      data: {
        errType: e instanceof KognitosApiError ? "KognitosApiError" : "Error",
        kognitosStatus: e instanceof KognitosApiError ? e.status : null,
        errPreview: (e instanceof Error ? e.message : String(e)).slice(0, 900),
        bodySnippet:
          e instanceof KognitosApiError
            ? e.bodySnippet?.slice(0, 600)
            : undefined,
      },
    });
    if (e instanceof KognitosApiError) {
      const upstream = e.status;
      const clientStatus =
        upstream === 401 || upstream === 403
          ? 502
          : upstream >= 400 && upstream < 600
            ? upstream
            : 502;
      if (upstream === 403) {
        return NextResponse.json(
          {
            error: e.message,
            code: "kognitos_forbidden",
            kognitosStatus: upstream,
            bodySnippet: e.bodySnippet?.slice(0, 800),
            hint:
              "Kognitos rejected this credential for POST …/runs/{run}/exceptions:reply (IAM). If both KOGNITOS_PAT and KOGNITOS_API_KEY are set, the app uses only the PAT — try a PAT with exception-reply access, or unset KOGNITOS_PAT temporarily to use the API key. Otherwise confirm workspace membership/role for this org and workspace.",
          },
          { status: clientStatus },
        );
      }
      return NextResponse.json(
        {
          error: e.message,
          code: "kognitos_api_error",
          kognitosStatus: upstream,
          bodySnippet: e.bodySnippet?.slice(0, 800),
        },
        { status: clientStatus },
      );
    }
    const err = e instanceof Error ? e.message : "reply_failed";
    return NextResponse.json({ error: err }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
