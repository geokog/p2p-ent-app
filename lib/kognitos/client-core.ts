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
  // Prefer PAT when both are set — matches Kognitos REST docs and operator flows (e.g. exception agent CreateEvent).
  const token =
    process.env.KOGNITOS_PAT?.trim() || process.env.KOGNITOS_API_KEY?.trim();
  if (!token) {
    throw new Error("Set KOGNITOS_PAT or KOGNITOS_API_KEY");
  }
  return `Bearer ${token}`;
}

function baseUrl(): string {
  const u = process.env.KOGNITOS_BASE_URL?.replace(/\/$/, "");
  if (!u) throw new Error("Set KOGNITOS_BASE_URL");
  return u;
}

/** Non-2xx from `kognitosFetchJson` — callers can branch on {@link KognitosApiError.status}. */
export class KognitosApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly bodySnippet: string;

  constructor(status: number, path: string, text: string) {
    const bodySnippet = text.slice(0, 800);
    super(`Kognitos API ${status} ${path}: ${bodySnippet}`);
    this.status = status;
    this.path = path;
    this.bodySnippet = bodySnippet;
    this.name = "KognitosApiError";
  }
}

/** Workspace JSON calls (Bearer PAT). Used by feature adapters (e.g. exceptions). */
export async function kognitosFetchJson<T>(
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
    throw new KognitosApiError(res.status, path, text);
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
 * POST `files/{file}:generateDownloadUrl` — returns a time-limited URI for direct
 * client display (OpenAPI `GenerateDownloadUrl`). Prefer over proxying bytes when
 * embedding or opening the run’s document.
 */
export async function generateOrganizationFileDownloadUrl(
  fileId: string,
  options?: { expireDuration?: string },
): Promise<string> {
  const org = requireOrg();
  const enc = encodeURIComponent(fileId);
  const path = `/api/v1/organizations/${encodeURIComponent(org)}/files/${enc}:generateDownloadUrl`;
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b999a8",
    },
    body: JSON.stringify({
      sessionId: "b999a8",
      runId: "pre-fix",
      hypothesisId: "H2",
      location: "client-core.ts:generateOrganizationFileDownloadUrl",
      message: "calling generateDownloadUrl",
      data: {
        fileIdLen: fileId.length,
        encLen: enc.length,
        pathTail: path.slice(-96),
        encHasEncodedColon: enc.includes("%3A"),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const body: Record<string, unknown> = {};
  if (options?.expireDuration?.trim()) {
    body.expire_duration = options.expireDuration.trim();
  }
  let raw: Record<string, unknown>;
  try {
    raw = await kognitosFetchJson<Record<string, unknown>>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (e) {
    // #region agent log
    const err = e instanceof KognitosApiError ? e : null;
    fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b999a8",
      },
      body: JSON.stringify({
        sessionId: "b999a8",
        runId: "pre-fix",
        hypothesisId: "H4",
        location: "client-core.ts:generateOrganizationFileDownloadUrl:err",
        message: "generateDownloadUrl API error",
        data: {
          status: err?.status ?? null,
          pathTail: err?.path?.slice(-96) ?? null,
          bodySnippet: err?.bodySnippet?.slice(0, 400) ?? String(e).slice(0, 400),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw e;
  }
  const uri =
    (typeof raw.download_uri === "string" && raw.download_uri.trim()) ||
    (typeof raw.downloadUri === "string" && raw.downloadUri.trim()) ||
    "";
  if (!uri) {
    throw new Error("Kognitos generateDownloadUrl: missing download_uri in response");
  }
  return uri;
}

function logKognitosFileDownloadNotOk(
  status: number,
  path: string,
  fileId: string,
  text: string,
): void {
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b999a8",
    },
    body: JSON.stringify({
      sessionId: "b999a8",
      hypothesisId: "H1",
      location: "client-core.ts:downloadOrganizationFile",
      message: "kognitos_files_download_not_ok",
      data: {
        status,
        path,
        fileIdPrefix: fileId.slice(0, 16),
        bodyPreview: text.slice(0, 240),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export type DownloadOrganizationFileOptions = {
  /** When org-level `…/files/{id}:download` returns 404, retry under this workspace. Defaults to `KOGNITOS_WORKSPACE_ID`. */
  workspaceId?: string;
};

/**
 * Stream a file from Kognitos Files API (binary). Caller must not forward credentials to the client.
 * Uses org-level download first; on **404** only, retries with `…/workspaces/{workspaceId}/files/…:download`
 * when a workspace id is available ({@link DownloadOrganizationFileOptions.workspaceId} or env).
 */
export async function downloadOrganizationFile(
  fileId: string,
  options?: DownloadOrganizationFileOptions,
): Promise<Response> {
  const org = requireOrg();
  const enc = encodeURIComponent(fileId);
  const orgPath = `/api/v1/organizations/${encodeURIComponent(org)}/files/${enc}:download`;
  const headers = {
    Authorization: authHeader(),
    Accept: "*/*",
  } as const;
  const urlBase = baseUrl();

  const res = await fetch(`${urlBase}${orgPath}`, { headers });
  if (res.ok) return res;

  const text = await res.text();

  if (res.status === 404) {
    const ws =
      options?.workspaceId?.trim() ||
      process.env.KOGNITOS_WORKSPACE_ID?.trim() ||
      "";
    if (ws) {
      logKognitosFileDownloadNotOk(res.status, orgPath, fileId, text);
      const wsPath = `/api/v1/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/files/${enc}:download`;
      const resWs = await fetch(`${urlBase}${wsPath}`, { headers });
      if (resWs.ok) return resWs;
      const textWs = await resWs.text();
      logKognitosFileDownloadNotOk(resWs.status, wsPath, fileId, textWs);
      throw new Error(
        `Kognitos download ${resWs.status} ${wsPath}: ${textWs.slice(0, 800)}`,
      );
    }
  }

  logKognitosFileDownloadNotOk(res.status, orgPath, fileId, text);
  throw new Error(
    `Kognitos download ${res.status} ${orgPath}: ${text.slice(0, 800)}`,
  );
}
