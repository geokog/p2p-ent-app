import "server-only";

import type {
  KognitosInsights,
  KognitosMetricResult,
  KognitosRun,
} from "@/lib/types";
import { automationShortIdFromResourceName } from "./automation-name";
import { mapRunFromApiJson } from "./map-run";

function orgId(): string {
  return (
    process.env.KOGNITOS_ORGANIZATION_ID ||
    process.env.KOGNITOS_ORG_ID ||
    ""
  );
}

function requireOrg(): string {
  const id = orgId();
  if (!id) {
    throw new Error(
      "Set KOGNITOS_ORGANIZATION_ID or KOGNITOS_ORG_ID in the environment",
    );
  }
  return id;
}

function requireWorkspace(): string {
  const id = process.env.KOGNITOS_WORKSPACE_ID;
  if (!id) throw new Error("Set KOGNITOS_WORKSPACE_ID");
  return id;
}

/** Short automation id for API paths (falls back to env when omitted). */
export function resolveAutomationId(explicit?: string): string {
  const id = explicit ?? process.env.KOGNITOS_AUTOMATION_ID;
  if (!id) throw new Error("Set KOGNITOS_AUTOMATION_ID or pass automationId");
  return id;
}

function authHeader(): string {
  const token = process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT;
  if (!token) {
    throw new Error("Set KOGNITOS_API_KEY or KOGNITOS_PAT");
  }
  return `Bearer ${token}`;
}

function baseUrl(): string {
  const u = process.env.KOGNITOS_BASE_URL?.replace(/\/$/, "");
  if (!u) throw new Error("Set KOGNITOS_BASE_URL");
  return u;
}

async function kognitosFetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Kognitos API ${res.status} ${path}: ${text.slice(0, 800)}`,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function strMoney(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toFixed(2);
  return "0";
}

/** Map org-level dashboards:queryInsights JSON to our `KognitosInsights` shape. */
export function normalizeInsightsResponse(
  raw: Record<string, unknown>,
): KognitosInsights {
  const vi = (raw.valueInsight ?? {}) as Record<string, unknown>;
  const ri = (raw.runInsight ?? {}) as Record<string, unknown>;
  const ci = (raw.completionInsight ?? {}) as Record<string, unknown>;
  const ag = (raw.awaitingGuidanceInsight ?? {}) as Record<string, unknown>;
  const trend = (ri.trend ?? {}) as Record<string, unknown>;
  const cppRaw = ci.completionsPerPeriod;
  const cpp = Array.isArray(cppRaw) ? cppRaw : [];

  return {
    valueInsight: {
      totalMoneySavedUsd: strMoney(vi.totalMoneySavedUsd),
      totalTimeSavedSecs: num(vi.totalTimeSavedSecs),
    },
    runInsight: {
      totalRunsCount: num(ri.totalRunsCount),
      trend: {
        percentChange: num(trend.percentChange),
        comparisonWindow: String(trend.comparisonWindow ?? "period"),
      },
    },
    completionInsight: {
      totalPercentCompletions: num(ci.totalPercentCompletions),
      stp: num(ci.stp),
      completionsPerPeriod: cpp.map((p) => {
        const row = (p ?? {}) as Record<string, unknown>;
        return {
          windowLabel: String(row.windowLabel ?? ""),
          autoCompletedCount: num(row.autoCompletedCount),
          manuallyResolvedCount: num(row.manuallyResolvedCount),
        };
      }),
    },
    awaitingGuidanceInsight: {
      totalRunsAwaitingGuidance: num(
        ag.totalRunsAwaitingGuidance ?? ag.total_runs_awaiting_guidance,
      ),
    },
  };
}

function mapMetricResults(raw: Record<string, unknown>): KognitosMetricResult[] {
  const results = raw.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const mr = (r ?? {}) as Record<string, unknown>;
    const seriesRaw = mr.series;
    const series = Array.isArray(seriesRaw) ? seriesRaw : [];
    return {
      metric: String(mr.metric ?? ""),
      interval: String(mr.interval ?? ""),
      series: series.map((s) => {
        const sr = (s ?? {}) as Record<string, unknown>;
        const tags =
          sr.tags && typeof sr.tags === "object"
            ? (sr.tags as Record<string, string>)
            : {};
        const pointsRaw = sr.points;
        const points = Array.isArray(pointsRaw) ? pointsRaw : [];
        return {
          tags,
          points: points.map((pt) => {
            const p = (pt ?? {}) as Record<string, unknown>;
            return {
              startTime: String(p.startTime ?? ""),
              value: num(p.value),
              windowLabel: String(p.windowLabel ?? ""),
            };
          }),
        };
      }),
    };
  });
}

export type RawAutomation = Record<string, unknown>;

/** GET …/workspaces/{ws}/automations — one page (raw API JSON). */
export async function listAutomationsRaw(options?: {
  pageSize?: number;
  pageToken?: string | null;
  /** AIP-160 filter, e.g. `stage = "PUBLISHED"` for List Automations. */
  filter?: string;
}): Promise<{
  automations: RawAutomation[];
  nextPageToken: string | null;
}> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const pageSize = Math.min(options?.pageSize ?? 100, 1000);
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  if (options?.pageToken) params.set("page_token", options.pageToken);
  if (options?.filter) params.set("filter", options.filter);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations?${params}`;
  const data = await kognitosFetchJson<Record<string, unknown>>(path);
  const raw = (data.automations ?? data.automation ?? []) as unknown[];
  const automations = raw.map((a) => (a ?? {}) as RawAutomation);
  const nextPageToken =
    (typeof data.next_page_token === "string"
      ? data.next_page_token
      : null) ??
    (typeof data.nextPageToken === "string" ? data.nextPageToken : null);
  return { automations, nextPageToken };
}

/** Paginate ListAutomations until all automations are loaded. */
export async function listAllAutomationsRaw(options?: {
  filter?: string;
}): Promise<RawAutomation[]> {
  const out: RawAutomation[] = [];
  let pageToken: string | null = null;
  const filter = options?.filter;
  do {
    const page = await listAutomationsRaw({
      pageSize: 100,
      pageToken,
      filter,
    });
    out.push(...page.automations);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** GET …/workspaces/{ws}/automations/{automation_id} — raw automation resource. */
export async function getAutomationRaw(
  automationId: string,
): Promise<Record<string, unknown>> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(automationId)}`;
  return kognitosFetchJson<Record<string, unknown>>(path);
}

/** GET …/automations/{id}/runs/{runId} */
export async function getRun(
  runId: string,
  automationId?: string,
): Promise<KognitosRun | null> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = resolveAutomationId(automationId);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(runId)}`;
  const data = await kognitosFetchJson<Record<string, unknown>>(path);
  if (!data || typeof data !== "object") return null;
  return mapRunFromApiJson(data);
}

export async function listRuns(options?: {
  pageSize?: number;
  filter?: string;
  pageToken?: string | null;
  automationId?: string;
}): Promise<{ runs: KognitosRun[]; nextPageToken: string | null }> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = resolveAutomationId(options?.automationId);
  const pageSize = Math.min(options?.pageSize ?? 100, 1000);
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  if (options?.pageToken) params.set("page_token", options.pageToken);
  if (options?.filter) params.set("filter", options.filter);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs?${params}`;
  const data = await kognitosFetchJson<{
    runs?: unknown[];
    nextPageToken?: string;
    next_page_token?: string;
  }>(path);
  const runs = (data.runs ?? []).map((r) =>
    mapRunFromApiJson(r as Record<string, unknown>),
  );
  const nextPageToken =
    (typeof data.nextPageToken === "string" ? data.nextPageToken : null) ??
    (typeof data.next_page_token === "string" ? data.next_page_token : null);
  return {
    runs,
    nextPageToken,
  };
}

/** Paginate until all runs for the automation are loaded (used by sync). */
export async function listAllRunsForAutomation(options?: {
  pageSize?: number;
  filter?: string;
  automationId?: string;
}): Promise<KognitosRun[]> {
  const out: KognitosRun[] = [];
  let pageToken: string | null = null;
  do {
    const page = await listRuns({
      pageSize: options?.pageSize ?? 100,
      filter: options?.filter,
      pageToken,
      automationId: options?.automationId,
    });
    out.push(...page.runs);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Same as {@link listRuns} but returns unmodified API JSON so `user_inputs` / `file` structures are preserved for storage.
 */
export async function listRunsRaw(options?: {
  pageSize?: number;
  filter?: string;
  pageToken?: string | null;
  automationId?: string;
}): Promise<{ runs: Record<string, unknown>[]; nextPageToken: string | null }> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = resolveAutomationId(options?.automationId);
  const pageSize = Math.min(options?.pageSize ?? 100, 1000);
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  if (options?.pageToken) params.set("page_token", options.pageToken);
  if (options?.filter) params.set("filter", options.filter);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs?${params}`;
  const data = await kognitosFetchJson<Record<string, unknown>>(path);
  const rawRuns = (data.runs ?? []) as unknown[];
  const runs = rawRuns.map((r) => (r ?? {}) as Record<string, unknown>);
  const nextPageToken =
    (typeof data.nextPageToken === "string" ? data.nextPageToken : null) ??
    (typeof data.next_page_token === "string" ? data.next_page_token : null);
  return { runs, nextPageToken };
}

/** Paginate ListRuns without mapping — preserves `user_inputs` file refs for `kognitos_runs.payload`. */
export async function listAllRunsForAutomationRaw(options?: {
  pageSize?: number;
  filter?: string;
  automationId?: string;
}): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let pageToken: string | null = null;
  do {
    const page = await listRunsRaw({
      pageSize: options?.pageSize ?? 100,
      filter: options?.filter,
      pageToken,
      automationId: options?.automationId,
    });
    out.push(...page.runs);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** GET run by short id — raw JSON (for payload repair / verification). */
export async function getRunRaw(
  runId: string,
  automationId?: string,
): Promise<Record<string, unknown> | null> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const auto = resolveAutomationId(automationId);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(auto)}/runs/${encodeURIComponent(runId)}`;
  const data = await kognitosFetchJson<Record<string, unknown>>(path);
  if (!data || typeof data !== "object") return null;
  return data;
}

export async function queryInsights(): Promise<KognitosInsights> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams();
  params.set(
    "filter.timeWindow.startTime",
    start.toISOString(),
  );
  params.set("filter.timeWindow.endTime", end.toISOString());
  params.set("filter.timeWindow.timeZone", "UTC");
  params.append(
    "filter.workspaceIds",
    `organizations/${org}/workspaces/${ws}`,
  );
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/dashboards:queryInsights?${params}`;
  const raw = await kognitosFetchJson<Record<string, unknown>>(path);
  return normalizeInsightsResponse(raw);
}

export async function queryMetrics(options?: {
  metrics?: string[];
  groupBy?: string[];
  interval?: string;
}): Promise<{ results: KognitosMetricResult[] }> {
  const org = requireOrg();
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams();
  const metricNames =
    options?.metrics && options.metrics.length > 0 ? options.metrics : ["runs"];
  for (const m of metricNames) params.append("metrics", m);
  params.set("startTime", start.toISOString());
  params.set("endTime", end.toISOString());
  if (options?.interval) params.set("interval", options.interval);
  if (options?.groupBy?.length) {
    for (const g of options.groupBy) params.append("groupBy", g);
  }
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/metrics:query?${params}`;
  const raw = await kognitosFetchJson<Record<string, unknown>>(path);
  return { results: mapMetricResults(raw) };
}

/** Short id for aggregate keys — API may return full resource name or short id. */
function shortAutomationIdFromAggregateField(idField: string): string {
  const s = idField.trim();
  if (!s) return "";
  return automationShortIdFromResourceName(s) ?? s;
}

function parseAutomationRunAggregateEntries(raw: Record<string, unknown>): {
  automationId: string;
  stats: { totalRuns: number; completedRuns: number };
}[] {
  const rawList =
    (Array.isArray(raw.automation_run_aggregates)
      ? raw.automation_run_aggregates
      : null) ??
    (Array.isArray(raw.automationRunAggregates)
      ? raw.automationRunAggregates
      : null) ??
    [];
  const out: {
    automationId: string;
    stats: { totalRuns: number; completedRuns: number };
  }[] = [];
  for (const item of rawList) {
    const e = (item ?? {}) as Record<string, unknown>;
    const idField = String(e.automation_id ?? e.automationId ?? "");
    const shortId = shortAutomationIdFromAggregateField(idField);
    const statsObj = (e.stats ?? {}) as Record<string, unknown>;
    const totalRuns = num(
      statsObj.total_runs ?? statsObj.totalRuns,
    );
    const completedRuns = num(
      statsObj.completed_runs ?? statsObj.completedRuns,
    );
    out.push({
      automationId: shortId || idField,
      stats: { totalRuns, completedRuns },
    });
  }
  return out;
}

export async function getAutomationRunAggregates(): Promise<{
  automationRunAggregates: {
    automationId: string;
    stats: { totalRuns: number; completedRuns: number };
  }[];
}> {
  const org = requireOrg();
  const ws = requireWorkspace();
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}:automationRunAggregates`;
  const raw = await kognitosFetchJson<Record<string, unknown>>(path);
  return {
    automationRunAggregates: parseAutomationRunAggregateEntries(raw),
  };
}

/**
 * `stats.total_runs` per automation short id (QueryAutomationRunAggregates).
 * One request for the workspace — use instead of paginating ListRuns for headline counts.
 */
export async function getTotalRunsByAutomationShortId(): Promise<
  Map<string, number>
> {
  const { automationRunAggregates } = await getAutomationRunAggregates();
  const map = new Map<string, number>();
  for (const e of automationRunAggregates) {
    if (!e.automationId) continue;
    map.set(e.automationId, e.stats.totalRuns);
  }
  return map;
}

/**
 * Stream a file from Kognitos org Files API (binary). Caller must not forward credentials to the client.
 */
export async function downloadOrganizationFile(fileId: string): Promise<Response> {
  const org = requireOrg();
  const enc = encodeURIComponent(fileId);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/files/${enc}:download`;
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: {
      Authorization: authHeader(),
      Accept: "*/*",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Kognitos download ${res.status} ${path}: ${text.slice(0, 800)}`,
    );
  }
  return res;
}
