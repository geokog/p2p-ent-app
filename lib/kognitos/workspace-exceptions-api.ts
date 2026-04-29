import "server-only";

import { kognitosFetchJson } from "./client-core";
import { exceptionShortIdFromExceptionResourceName } from "./kognitos-resource-ids";

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
 * Resolution thread events per Kognitos plugin `exceptions-api.md`:
 * `GET …/automations/{auto}/runs/{run}/exceptions/{exception_id}/events`
 */
export async function listExceptionResolutionEvents(options: {
  automationId: string;
  runId: string;
  exceptionIdShort: string;
  pageSize?: number;
}): Promise<{ raw: Record<string, unknown>; agentIdUsed: string | null }> {
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
  const raw = await kognitosFetchJson<Record<string, unknown>>(path);
  const ev = raw.events ?? raw.run_events ?? raw.runEvents;
  const normalized =
    Array.isArray(ev) && raw.events === undefined
      ? { ...raw, events: ev }
      : raw;
  return { raw: normalized as Record<string, unknown>, agentIdUsed: "exceptions" };
}

/**
 * Reply per Kognitos plugin `exceptions-api.md`:
 * `POST …/automations/{auto}/runs/{run}/exceptions:reply` with `{ message, exception_id }`.
 */
export async function replyToWorkspaceException(options: {
  automationId: string;
  runId: string;
  message: string;
  exceptionId?: string;
}): Promise<void> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = options.automationId.trim();
  const run = options.runId.trim();
  const msg = options.message.trim();
  if (!auto || !run || !msg) throw new Error("automationId, runId, and non-empty message required");

  const ex = options.exceptionId?.trim();
  const exForReply = ex
    ? (exceptionShortIdFromExceptionResourceName(ex) ?? ex)
    : undefined;

  const body: Record<string, unknown> = { message: msg };
  if (exForReply) {
    body.exception_id = exForReply;
    body.exceptionId = exForReply;
  }

  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(run)}/exceptions:reply`;
  await kognitosFetchJson<unknown>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
