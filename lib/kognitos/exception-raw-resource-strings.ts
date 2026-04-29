/**
 * Extract run / automation resource strings from raw Kognitos exception JSON.
 * Keep in sync for list/detail mapping and reply routing (GET exception payload).
 */

import { agentIdFromAgentsResourceString } from "./kognitos-resource-ids";

function trimStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/** Run resource name (full path); some payloads use `run_name` instead of `run`. */
export function runResourceStringFromExceptionRaw(
  raw: Record<string, unknown>,
): string | undefined {
  return (
    trimStr(raw.run) ?? trimStr((raw as { run_name?: unknown }).run_name)
  );
}

/** Automation resource name; OpenAPI documents `automation` only — no known alternates in-repo. */
export function automationResourceStringFromExceptionRaw(
  raw: Record<string, unknown>,
): string | undefined {
  return trimStr(raw.automation);
}

/**
 * OpenAPI `v1Exception.resolver`: `users/{user}` or `agents/{agent}` when set.
 */
export function agentIdFromExceptionResolverRaw(
  raw: Record<string, unknown>,
): string | undefined {
  const r =
    trimStr(raw.resolver) ??
    trimStr((raw as { resolver_agent?: unknown }).resolver_agent);
  const id = r ? agentIdFromAgentsResourceString(r) : null;
  return id ?? undefined;
}
