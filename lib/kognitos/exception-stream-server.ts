import "server-only";

import { KognitosApiError } from "./client-core";

/**
 * Server-side proxies for the Kognitos `StreamEvents` (NDJSON) and
 * `CancelGeneration` operations on the agent-scoped events endpoint.
 *
 * These are intentionally small wrappers around `fetch` (rather than
 * `kognitosFetchJson`) because:
 *   - `StreamEvents` returns `application/x-ndjson` and must be streamed
 *     to the caller without buffering the entire body.
 *   - `CancelGeneration` returns `200` with an empty body but is otherwise
 *     a normal POST.
 *
 * Both call paths follow the OpenAPI surface in
 * `lib/kognitos/openapi.yaml` (`StreamEvents` ~L4962, `CancelGeneration` ~L5009).
 */

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

function requireBaseUrl(): string {
  const u = process.env.KOGNITOS_BASE_URL?.replace(/\/$/, "");
  if (!u) throw new Error("Set KOGNITOS_BASE_URL");
  return u;
}

function bearerCandidates(): string[] {
  const out: string[] = [];
  const pat = process.env.KOGNITOS_PAT?.trim();
  const apiKey = process.env.KOGNITOS_API_KEY?.trim();
  // Try API key first when both are set and distinct (matches `kognitosJsonAutomationScopedGet`).
  if (pat && apiKey && pat !== apiKey) {
    out.push(apiKey);
    out.push(pat);
  } else if (pat) {
    out.push(pat);
  } else if (apiKey) {
    out.push(apiKey);
  }
  if (out.length === 0) {
    throw new Error("Set KOGNITOS_PAT or KOGNITOS_API_KEY");
  }
  return out;
}

export type StreamExceptionEventsArgs = {
  automationId: string;
  runId: string;
  agentId: string;
  /** Optional abort signal forwarded to the upstream fetch. */
  signal?: AbortSignal;
};

/**
 * Open the upstream NDJSON stream and return its raw `Response`. The caller
 * is responsible for piping `body` to its own response (or consuming it).
 *
 * Tries each available bearer credential on `403`, similar to the JSON helper.
 */
export async function openExceptionEventStream(
  args: StreamExceptionEventsArgs,
): Promise<Response> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = args.automationId.trim();
  const run = args.runId.trim();
  const agent = args.agentId.trim();
  if (!auto || !run || !agent) {
    throw new Error("automationId, runId, and agentId required");
  }
  const path = `/api/v1/organizations/${encodeURIComponent(
    org,
  )}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(
    auto,
  )}/runs/${encodeURIComponent(run)}/agents/${encodeURIComponent(
    agent,
  )}/events:stream`;
  const url = `${requireBaseUrl()}${path}`;

  let lastError: KognitosApiError | null = null;
  for (const token of bearerCandidates()) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/x-ndjson",
      },
      signal: args.signal,
      cache: "no-store",
    });
    if (res.ok) return res;
    if (res.status !== 403) {
      const body = await res.text().catch(() => "");
      throw new KognitosApiError(res.status, path, body);
    }
    const body = await res.text().catch(() => "");
    lastError = new KognitosApiError(res.status, path, body);
  }
  throw lastError ?? new Error("kognitos_stream_unauthenticated");
}

export type CancelExceptionGenerationArgs = {
  automationId: string;
  runId: string;
  agentId: string;
};

/**
 * Issue `CancelGeneration` against the agent-scoped events endpoint.
 * Returns the parsed JSON (typically `{}`).
 */
export async function cancelExceptionGeneration(
  args: CancelExceptionGenerationArgs,
): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = args.automationId.trim();
  const run = args.runId.trim();
  const agent = args.agentId.trim();
  if (!auto || !run || !agent) {
    throw new Error("automationId, runId, and agentId required");
  }
  const path = `/api/v1/organizations/${encodeURIComponent(
    org,
  )}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(
    auto,
  )}/runs/${encodeURIComponent(run)}/agents/${encodeURIComponent(
    agent,
  )}/events:cancelGeneration`;
  const url = `${requireBaseUrl()}${path}`;

  let lastError: KognitosApiError | null = null;
  for (const token of bearerCandidates()) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    const text = await res.text();
    if (res.ok) {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    }
    if (res.status !== 403) {
      throw new KognitosApiError(res.status, path, text);
    }
    lastError = new KognitosApiError(res.status, path, text);
  }
  throw lastError ?? new Error("kognitos_cancel_unauthenticated");
}
