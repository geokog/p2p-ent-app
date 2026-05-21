import "server-only";

import { agentIdFromExceptionResolverRaw } from "./exception-raw-resource-strings";
import {
  getRunRaw,
  KognitosApiError,
  kognitosFetchJson,
  kognitosFetchJsonWithBearerToken,
  kognitosFetchJsonWithPat403Retry,
} from "./client-core";
import {
  agentIdFromEventResourceName,
  guessAgentIdFromJsonBlob,
} from "./kognitos-resource-ids";

function requireOrg(): string {
  const id =
    process.env.KOGNITOS_ORGANIZATION_ID?.trim() ||
    process.env.KOGNITOS_ORG_ID?.trim() ||
    "";
  if (!id) throw new Error("Set KOGNITOS_ORGANIZATION_ID or KOGNITOS_ORG_ID");
  return id;
}

function requireWorkspace(): string {
  const id = process.env.KOGNITOS_WORKSPACE_ID?.trim();
  if (!id) throw new Error("Set KOGNITOS_WORKSPACE_ID");
  return id;
}

const IS_DEV_KOGNITOS_AUTH_LOG = process.env.NODE_ENV === "development";

/**
 * GETs under `…/automations/{auto}/runs/{run}/…` often 403 with a user PAT while the same
 * org's workspace exception GET works. When PAT and API key are both set and differ, try
 * **API key first**, then PAT on 403. Otherwise delegate to {@link kognitosFetchJsonWithPat403Retry}
 * (PAT preferred, then API key on 403 when secrets differ).
 */
async function kognitosJsonAutomationScopedGet<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const pat = process.env.KOGNITOS_PAT?.trim();
  const apiKey = process.env.KOGNITOS_API_KEY?.trim();

  if (IS_DEV_KOGNITOS_AUTH_LOG) {
    const redacted = path.replace(
      /^(\/api\/v1\/organizations\/)[^/]+(\/workspaces\/)[^/]+/,
      "$1{org}$2{ws}",
    );
    console.log(
      "[kognitos][dev][automation-scoped GET]",
      JSON.stringify(
        {
          pathRedacted: redacted,
          patConfigured: Boolean(pat),
          apiKeyConfigured: Boolean(apiKey),
          secretsAreDistinct: Boolean(pat && apiKey && pat !== apiKey),
        },
        null,
        2,
      ),
    );
  }

  if (pat && apiKey && pat !== apiKey) {
    if (IS_DEV_KOGNITOS_AUTH_LOG) {
      console.log(
        "[kognitos][dev][automation-scoped GET] attempt 1: credentialType=API_KEY",
      );
    }
    try {
      return await kognitosFetchJsonWithBearerToken<T>(path, apiKey, init);
    } catch (e) {
      if (e instanceof KognitosApiError && e.status === 403) {
        if (IS_DEV_KOGNITOS_AUTH_LOG) {
          console.log(
            "[kognitos][dev][automation-scoped GET] attempt 1 returned 403; attempt 2: credentialType=PAT",
          );
        }
        return await kognitosFetchJsonWithBearerToken<T>(path, pat, init);
      }
      throw e;
    }
  }

  if (IS_DEV_KOGNITOS_AUTH_LOG) {
    const primary = pat ? "PAT" : apiKey ? "API_KEY" : "none";
    const note =
      pat && apiKey && pat === apiKey
        ? "PAT and API_KEY identical; Pat403Retry cannot swap; first attempt follows authHeader (PAT preferred)."
        : "Only one of PAT/API_KEY set; Pat403Retry uses that secret only.";
    console.log(
      "[kognitos][dev][automation-scoped GET] using kognitosFetchJsonWithPat403Retry",
      JSON.stringify(
        {
          primaryCredentialTypeFromAuthHeader: primary,
          note,
        },
        null,
        2,
      ),
    );
  }
  return kognitosFetchJsonWithPat403Retry<T>(path, init);
}

function agentIdFromListedEventItem(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  for (const key of ["name", "resourceName", "resource_name"] as const) {
    const v = r[key];
    if (typeof v === "string") {
      const a = agentIdFromEventResourceName(v);
      if (a) return a;
    }
  }
  return guessAgentIdFromJsonBlob(item, 8);
}

type ResolvedAgentId = {
  agentId: string;
  source: string;
};

function responseShape(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      out[k] = `array(${v.length})`;
    } else if (v === null) {
      out[k] = "null";
    } else {
      out[k] = typeof v;
    }
  }
  return out;
}

async function resolveAgentIdForDocumentedListEvents(options: {
  excRaw?: Record<string, unknown>;
  automationId: string;
  runId: string;
}): Promise<ResolvedAgentId | null> {
  if (options.excRaw) {
    const fromResolver = agentIdFromExceptionResolverRaw(options.excRaw);
    if (fromResolver) {
      return { agentId: fromResolver, source: "exception.resolver" };
    }

    const fromExceptionBlob = guessAgentIdFromJsonBlob(options.excRaw, 8);
    if (fromExceptionBlob) {
      return {
        agentId: fromExceptionBlob,
        source: "exception raw JSON blob",
      };
    }
  }

  try {
    const runRaw = await getRunRaw(options.runId, options.automationId);
    if (runRaw) {
      const fromRun = guessAgentIdFromJsonBlob(runRaw, 10);
      if (fromRun) {
        return { agentId: fromRun, source: "GET run raw JSON blob" };
      }
    }
  } catch (e) {
    if (IS_DEV_KOGNITOS_AUTH_LOG) {
      console.error(
        "[kognitos][dev][agent-scoped ListEvents diagnostic] getRunRaw agent probe failed",
        JSON.stringify(
          {
            automationId: options.automationId,
            runId: options.runId,
            error: e instanceof Error ? e.message : String(e),
          },
          null,
          2,
        ),
      );
    }
  }

  try {
    const org = requireOrg();
    const ws = requireWorkspace();
    const params = new URLSearchParams();
    params.set("page_size", "100");
    const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(options.automationId)}/runs/${encodeURIComponent(options.runId)}/events?${params}`;
    const raw = await kognitosJsonAutomationScopedGet<Record<string, unknown>>(path);
    const runEvents =
      (raw.run_events as unknown[]) ??
      (raw.runEvents as unknown[]) ??
      [];
    for (const item of runEvents) {
      const aid = guessAgentIdFromJsonBlob(item, 10);
      if (aid) {
        return {
          agentId: aid,
          source: "ListRunEvents event JSON blob",
        };
      }
    }
  } catch (e) {
    if (IS_DEV_KOGNITOS_AUTH_LOG) {
      console.error(
        "[kognitos][dev][agent-scoped ListEvents diagnostic] ListRunEvents agent probe failed",
        JSON.stringify(
          {
            automationId: options.automationId,
            runId: options.runId,
            pathTemplate:
              "GET …/automations/{automation_id}/runs/{run_id}/events?page_size=100",
            error: e instanceof Error ? e.message : String(e),
          },
          null,
          2,
        ),
      );
    }
  }

  const configuredFallback = process.env.KOGNITOS_EXCEPTION_AGENT_ID?.trim();
  if (configuredFallback) {
    return {
      agentId: configuredFallback,
      source: "env.KOGNITOS_EXCEPTION_AGENT_ID fallback",
    };
  }

  return null;
}

export async function listAgentScopedResolutionEvents(options: {
  automationId: string;
  runId: string;
  exceptionIdShort: string;
  excRaw?: Record<string, unknown>;
  pageSize?: number;
}): Promise<{
  raw: Record<string, unknown>;
  agentIdUsed: string;
  agentIdSource: string;
}> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = options.automationId.trim();
  const run = options.runId.trim();
  if (!auto || !run) throw new Error("automationId and runId required");

  const resolved = await resolveAgentIdForDocumentedListEvents({
    excRaw: options.excRaw,
    automationId: auto,
    runId: run,
  });
  if (!resolved) {
    throw new Error("agent_id_unresolved_for_list_events");
  }

  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/agents/${encodeURIComponent(resolved.agentId)}/events?${params}`;
  const raw = await kognitosJsonAutomationScopedGet<Record<string, unknown>>(path);
  const ev = raw.events ?? raw.run_events ?? raw.runEvents;
  const normalized =
    Array.isArray(ev) && raw.events === undefined
      ? { ...raw, events: ev }
      : raw;
  return {
    raw: normalized as Record<string, unknown>,
    agentIdUsed: resolved.agentId,
    agentIdSource: resolved.source,
  };
}

export async function devDiagnoseAgentScopedListEvents(options: {
  exceptionId: string;
  excRaw: Record<string, unknown>;
  automationId: string;
  runId: string;
}): Promise<void> {
  if (!IS_DEV_KOGNITOS_AUTH_LOG) return;

  // Diagnostic-only: validate the documented OpenAPI ListEvents path with the known
  // resolution agent id from the current environment. Do not use this for production
  // reply routing or event reads.
  const resolved = await resolveAgentIdForDocumentedListEvents({
    excRaw: options.excRaw,
    automationId: options.automationId,
    runId: options.runId,
  });

  if (!resolved) {
    console.log(
      "[kognitos][dev][agent-scoped ListEvents diagnostic]",
      JSON.stringify(
        {
          exceptionId: options.exceptionId,
          automationId: options.automationId,
          runId: options.runId,
          resolvedAgentId: null,
          agentIdSource: null,
          attemptedDocumentedListEvents: false,
          result: "skipped_no_agent_id",
        },
        null,
        2,
      ),
    );
    return;
  }

  const org = requireOrg();
  const ws = requireWorkspace();
  const params = new URLSearchParams();
  params.set("page_size", "50");
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(options.automationId)}/runs/${encodeURIComponent(options.runId)}/agents/${encodeURIComponent(resolved.agentId)}/events?${params}`;

  try {
    const raw = await kognitosJsonAutomationScopedGet<Record<string, unknown>>(path);
    const events =
      (raw.events as unknown[]) ??
      (raw.run_events as unknown[]) ??
      (raw.runEvents as unknown[]) ??
      [];
    console.log(
      "[kognitos][dev][agent-scoped ListEvents diagnostic]",
      JSON.stringify(
        {
          exceptionId: options.exceptionId,
          automationId: options.automationId,
          runId: options.runId,
          resolvedAgentId: resolved.agentId,
          agentIdSource: resolved.source,
          pathTemplate:
            "GET …/automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events?page_size=50",
          succeeded: true,
          rawResponseShape: responseShape(raw),
          topLevelKeys: Object.keys(raw),
          eventCount: Array.isArray(events) ? events.length : 0,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(
      "[kognitos][dev][agent-scoped ListEvents diagnostic]",
      JSON.stringify(
        {
          exceptionId: options.exceptionId,
          automationId: options.automationId,
          runId: options.runId,
          resolvedAgentId: resolved.agentId,
          agentIdSource: resolved.source,
          pathTemplate:
            "GET …/automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events?page_size=50",
          succeeded: false,
          errorType: e instanceof KognitosApiError ? "KognitosApiError" : "Error",
          kognitosStatus: e instanceof KognitosApiError ? e.status : null,
          error: e instanceof Error ? e.message : String(e),
        },
        null,
        2,
      ),
    );
  }
}

export type WorkspaceExceptionStateFilter =
  | "pending"
  | "archived"
  | "resolved"
  | "non_resolved";

export function listExceptionsFilterExpression(
  state: WorkspaceExceptionStateFilter,
): string {
  switch (state) {
    case "pending":
      return 'state = "PENDING"';
    case "archived":
      return 'state = "ARCHIVED"';
    case "resolved":
      return 'state = "RESOLVED"';
    case "non_resolved":
      return 'NOT state = "RESOLVED"';
    default:
      return 'state = "PENDING"';
  }
}

export async function listWorkspaceExceptions(options: {
  state: WorkspaceExceptionStateFilter;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const params = new URLSearchParams();
  params.set("filter", listExceptionsFilterExpression(options.state));
  params.set("page_size", String(pageSize));
  if (options.pageToken) params.set("page_token", options.pageToken);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/exceptions?${params}`;
  return kognitosFetchJson<Record<string, unknown>>(path);
}

export async function getWorkspaceException(
  exceptionId: string,
): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const id = exceptionId.trim();
  if (!id) throw new Error("exceptionId required");
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/exceptions/${encodeURIComponent(id)}`;
  return kognitosFetchJson<Record<string, unknown>>(path);
}

/**
 * Resolution thread events.
 *
 * Primary path follows checked-in OpenAPI ListEvents:
 * `GET …/automations/{auto}/runs/{run}/agents/{agent}/events`.
 *
 * The older exception-nested path is kept as a transition fallback because some
 * previous Kognitos plugin notes referenced it.
 */
export async function listExceptionResolutionEvents(options: {
  automationId: string;
  runId: string;
  exceptionIdShort: string;
  excRaw?: Record<string, unknown>;
  pageSize?: number;
}): Promise<{ raw: Record<string, unknown>; agentIdUsed: string | null }> {
  try {
    const { raw, agentIdUsed, agentIdSource } = await listAgentScopedResolutionEvents({
      automationId: options.automationId,
      runId: options.runId,
      exceptionIdShort: options.exceptionIdShort,
      excRaw: options.excRaw,
      pageSize: options.pageSize,
    });
    if (IS_DEV_KOGNITOS_AUTH_LOG) {
      console.log(
        "[kognitos][dev] primary ListEvents source=agent-scoped",
        JSON.stringify(
          {
            automationId: options.automationId,
            runId: options.runId,
            exceptionIdShort: options.exceptionIdShort,
            agentIdUsed,
            agentIdSource,
          },
          null,
          2,
        ),
      );
    }
    return { raw, agentIdUsed };
  } catch (e) {
    if (IS_DEV_KOGNITOS_AUTH_LOG) {
      console.error(
        "[kognitos][dev] primary agent-scoped ListEvents failed; trying legacy exception-nested fallback",
        JSON.stringify(
          {
            automationId: options.automationId,
            runId: options.runId,
            exceptionIdShort: options.exceptionIdShort,
            errorType: e instanceof KognitosApiError ? "KognitosApiError" : "Error",
            kognitosStatus: e instanceof KognitosApiError ? e.status : null,
            error: e instanceof Error ? e.message : String(e),
          },
          null,
          2,
        ),
      );
    }
  }

  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = options.automationId.trim();
  const run = options.runId.trim();
  const exc = options.exceptionIdShort.trim();
  if (!auto || !run || !exc) throw new Error("automationId, runId, and exceptionId required");

  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/exceptions/${encodeURIComponent(exc)}/events?${params}`;
  const raw = await kognitosJsonAutomationScopedGet<Record<string, unknown>>(path);
  const ev = raw.events ?? raw.run_events ?? raw.runEvents;
  const normalized =
    Array.isArray(ev) && raw.events === undefined
      ? { ...raw, events: ev }
      : raw;
  const list = (normalized as { events?: unknown[] }).events ?? [];
  let agentIdUsed: string | null = null;
  for (const item of list) {
    const aid = agentIdFromListedEventItem(item);
    if (aid) {
      agentIdUsed = aid;
      break;
    }
  }
  return { raw: normalized as Record<string, unknown>, agentIdUsed };
}

/**
 * OpenAPI: only `user_message` may be set on create; use full exception name when available.
 * @see CreateEvent — POST …/runs/{run_id}/agents/{agent_id}/events
 */
export async function resolveAgentIdForExceptionReply(options: {
  excRaw: Record<string, unknown>;
  automationId: string;
  runId: string;
  exceptionIdShort: string;
}): Promise<string | null> {
  const override = process.env.KOGNITOS_EXCEPTION_AGENT_ID?.trim();
  if (override) return override;

  const resolverRaw = options.excRaw.resolver;
  const resolverKind =
    typeof resolverRaw === "string"
      ? resolverRaw.startsWith("agents/")
        ? "agents_prefix"
        : resolverRaw.startsWith("users/")
          ? "users_prefix"
          : "string_other"
      : "none";
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b0c4b9",
    },
    body: JSON.stringify({
      sessionId: "b0c4b9",
      hypothesisId: "H3",
      location: "workspace-exceptions-api.ts:resolveAgentId:entry",
      message: "resolver_shape",
      data: { resolverKind, exceptionIdShortLen: options.exceptionIdShort.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const fromResolver = agentIdFromExceptionResolverRaw(options.excRaw);
  if (fromResolver) return fromResolver;
  const guessed = guessAgentIdFromJsonBlob(options.excRaw, 8);
  if (guessed) return guessed;
  try {
    const { raw, agentIdUsed } = await listExceptionResolutionEvents({
      automationId: options.automationId,
      runId: options.runId,
      exceptionIdShort: options.exceptionIdShort,
      pageSize: 50,
    });
    const list = (raw.events as unknown[]) ?? [];
    const firstName =
      list[0] &&
      typeof list[0] === "object" &&
      typeof (list[0] as { name?: unknown }).name === "string";
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H1_H2",
        location: "workspace-exceptions-api.ts:resolveAgentId:afterListExceptionEvents",
        message: "exception_thread_list_result",
        data: {
          eventCount: list.length,
          agentIdUsedFromListFn: Boolean(agentIdUsed),
          firstEventHasStringName: Boolean(firstName),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (agentIdUsed) return agentIdUsed;
    for (const item of list) {
      const aid = agentIdFromListedEventItem(item);
      if (aid) return aid;
    }
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b0c4b9",
      },
      body: JSON.stringify({
        sessionId: "b0c4b9",
        hypothesisId: "H1_H2",
        location: "workspace-exceptions-api.ts:resolveAgentId:listExceptionEventsCatch",
        message: "exception_thread_list_error",
        data: {
          isKognitosApiError: e instanceof KognitosApiError,
          kognitosStatus: e instanceof KognitosApiError ? e.status : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    /* list may 404 if thread empty — caller treats unresolved agent */
  }
  try {
    const runRaw = await getRunRaw(options.runId, options.automationId);
    if (runRaw) {
      const fromRun = guessAgentIdFromJsonBlob(runRaw, 10);
      if (fromRun) return fromRun;
    }
  } catch {
    /* ignore */
  }
  try {
    const org = requireOrg();
    const ws = requireWorkspace();
    const auto = options.automationId.trim();
    const run = options.runId.trim();
    const params = new URLSearchParams();
    params.set("page_size", "100");
    const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/events?${params}`;
    const raw = await kognitosJsonAutomationScopedGet<Record<string, unknown>>(path);
    const runEvents =
      (raw.run_events as unknown[]) ??
      (raw.runEvents as unknown[]) ??
      [];
    for (const item of runEvents) {
      const aid = guessAgentIdFromJsonBlob(item, 10);
      if (aid) return aid;
    }
  } catch {
    /* ignore */
  }
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b0c4b9",
    },
    body: JSON.stringify({
      sessionId: "b0c4b9",
      hypothesisId: "H1_H3_H5",
      location: "workspace-exceptions-api.ts:resolveAgentId:returnNull",
      message: "all_resolution_steps_exhausted",
      data: {},
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return null;
}

/**
 * Reply — OpenAPI Create Event:
 * `POST …/automations/{auto}/runs/{run}/agents/{agent}/events`
 * body `{ user_message: { content }, exception? }`.
 */
export async function replyToWorkspaceException(options: {
  automationId: string;
  runId: string;
  agentId: string;
  message: string;
  /** Full resource name `organizations/.../exceptions/{id}` when known (GET exception `name`). */
  exceptionResourceName?: string;
}): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = options.automationId.trim();
  const run = options.runId.trim();
  const agent = options.agentId.trim();
  const msg = options.message.trim();
  if (!auto || !run || !agent || !msg) {
    throw new Error("automationId, runId, agentId, and non-empty message required");
  }

  const body: Record<string, unknown> = {
    user_message: { content: msg },
  };
  const exName = options.exceptionResourceName?.trim();
  if (exName) body.exception = exName;

  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/agents/${encodeURIComponent(agent)}/events`;
  const init: RequestInit = {
    method: "POST",
    body: JSON.stringify(body),
  };

  const pat = process.env.KOGNITOS_PAT?.trim();
  const apiKey = process.env.KOGNITOS_API_KEY?.trim();

  try {
    return await kognitosFetchJson<Record<string, unknown>>(path, init);
  } catch (e) {
    if (
      e instanceof KognitosApiError &&
      e.status === 403 &&
      pat &&
      apiKey &&
      pat !== apiKey
    ) {
      return await kognitosFetchJsonWithBearerToken<Record<string, unknown>>(
        path,
        apiKey,
        init,
      );
    }
    throw e;
  }
}
