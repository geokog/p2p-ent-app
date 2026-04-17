/**
 * Mock Kognitos API client.
 *
 * CUSTOMIZE: Replace the mock data below with real API calls to the Kognitos
 * platform, or adjust the mock runs / events to match your domain's SOPs.
 */

import type {
  KognitosRun,
  KognitosRunEvent,
  KognitosInsights,
  KognitosMetricResult,
} from "@/lib/types";

// ── Mock Runs ──────────────────────────────────────────────────
// CUSTOMIZE: Add, remove, or modify runs to match your workflow scenarios.

const mockRuns: KognitosRun[] = [
  {
    name: "workspaces/ws-1/runs/run-1",
    createTime: "2026-02-20T09:00:00Z",
    updateTime: "2026-02-20T09:04:32Z",
    state: {
      completed: {
        outputs: {
          status: "approved",
          reviewer_notes: "Budget within limits",
          confidence_score: "85",
        },
      },
    },
    stage: "review-request",
    stageVersion: "1.0",
    invocationDetails: { invocationSource: "api" },
    userInputs: {
      request_id: "req-4",
      title: "Cloud Server Upgrade",
      category: "equipment",
    },
  },
  {
    name: "workspaces/ws-1/runs/run-2",
    createTime: "2026-02-21T14:30:00Z",
    updateTime: "2026-02-21T14:33:15Z",
    state: {
      completed: {
        outputs: {
          status: "under_review",
          escalation_reason: "Exceeds budget threshold",
          assigned_to: "user-3",
        },
      },
    },
    stage: "escalate-request",
    stageVersion: "1.0",
    invocationDetails: { invocationSource: "api" },
    userInputs: {
      request_id: "req-7",
      title: "Annual Consulting Contract",
      category: "consulting",
    },
  },
];

// ── Mock Run Events ────────────────────────────────────────────
// CUSTOMIZE: Adjust event descriptions and node kinds to reflect your SOP steps.

const mockRunEvents: KognitosRunEvent[] = [
  // --- run-1 events (review-request) ---
  {
    id: "evt-1-1",
    runId: "run-1",
    timestamp: "2026-02-20T09:00:05Z",
    type: "runUpdate",
    description: "Run started for review-request SOP",
  },
  {
    id: "evt-1-2",
    runId: "run-1",
    timestamp: "2026-02-20T09:01:10Z",
    type: "executionJournal",
    nodeKind: "action",
    description: "Fetched request details for req-4",
    details: { request_id: "req-4" },
  },
  {
    id: "evt-1-3",
    runId: "run-1",
    timestamp: "2026-02-20T09:02:00Z",
    type: "executionJournal",
    nodeKind: "decision",
    description: "Evaluated budget rule — within limits",
    details: { rule: "budget_check", result: "pass" },
  },
  {
    id: "evt-1-4",
    runId: "run-1",
    timestamp: "2026-02-20T09:02:45Z",
    type: "executionJournal",
    nodeKind: "action",
    description: "Calculated confidence score: 85",
    details: { confidence_score: 85 },
  },
  {
    id: "evt-1-5",
    runId: "run-1",
    timestamp: "2026-02-20T09:03:30Z",
    type: "executionJournal",
    nodeKind: "action",
    description: "Reviewer notes recorded: Budget within limits",
  },
  {
    id: "evt-1-6",
    runId: "run-1",
    timestamp: "2026-02-20T09:04:32Z",
    type: "runUpdate",
    description: "Run completed — request approved",
    details: { status: "approved" },
  },

  // --- run-2 events (escalate-request) ---
  {
    id: "evt-2-1",
    runId: "run-2",
    timestamp: "2026-02-21T14:30:05Z",
    type: "runUpdate",
    description: "Run started for escalate-request SOP",
  },
  {
    id: "evt-2-2",
    runId: "run-2",
    timestamp: "2026-02-21T14:31:20Z",
    type: "executionJournal",
    nodeKind: "decision",
    description: "Budget threshold exceeded — escalation required",
    details: { rule: "budget_threshold", result: "fail" },
  },
  {
    id: "evt-2-3",
    runId: "run-2",
    timestamp: "2026-02-21T14:32:10Z",
    type: "executionJournal",
    nodeKind: "action",
    description: "Assigned escalation to user-3",
    details: { assigned_to: "user-3" },
  },
  {
    id: "evt-2-4",
    runId: "run-2",
    timestamp: "2026-02-21T14:33:15Z",
    type: "runUpdate",
    description: "Run completed — request under review (escalated)",
    details: { status: "under_review" },
  },
];

// ── Mock Insights ──────────────────────────────────────────────
// CUSTOMIZE: Adjust totals to stay consistent with your mock runs.

const mockInsights: KognitosInsights = {
  valueInsight: {
    totalMoneySavedUsd: "4200.00",
    totalTimeSavedSecs: 1620,
  },
  runInsight: {
    totalRunsCount: 2,
    trend: { percentChange: 0, comparisonWindow: "week" },
  },
  completionInsight: {
    totalPercentCompletions: 100,
    stp: 100,
    completionsPerPeriod: [
      {
        windowLabel: "2026-02-20",
        autoCompletedCount: 1,
        manuallyResolvedCount: 0,
      },
      {
        windowLabel: "2026-02-21",
        autoCompletedCount: 1,
        manuallyResolvedCount: 0,
      },
    ],
  },
  awaitingGuidanceInsight: {
    totalRunsAwaitingGuidance: 0,
  },
};

// ── Mock Metrics ───────────────────────────────────────────────
// CUSTOMIZE: Add or modify metric series to power your dashboard charts.

const mockMetricResults: KognitosMetricResult[] = [
  {
    metric: "runs_completed",
    interval: "1d",
    series: [
      {
        tags: { stage: "review-request" },
        points: [
          { startTime: "2026-02-18T00:00:00Z", value: 0, windowLabel: "Feb 18" },
          { startTime: "2026-02-19T00:00:00Z", value: 0, windowLabel: "Feb 19" },
          { startTime: "2026-02-20T00:00:00Z", value: 1, windowLabel: "Feb 20" },
          { startTime: "2026-02-21T00:00:00Z", value: 0, windowLabel: "Feb 21" },
          { startTime: "2026-02-22T00:00:00Z", value: 0, windowLabel: "Feb 22" },
        ],
      },
      {
        tags: { stage: "escalate-request" },
        points: [
          { startTime: "2026-02-18T00:00:00Z", value: 0, windowLabel: "Feb 18" },
          { startTime: "2026-02-19T00:00:00Z", value: 0, windowLabel: "Feb 19" },
          { startTime: "2026-02-20T00:00:00Z", value: 0, windowLabel: "Feb 20" },
          { startTime: "2026-02-21T00:00:00Z", value: 1, windowLabel: "Feb 21" },
          { startTime: "2026-02-22T00:00:00Z", value: 0, windowLabel: "Feb 22" },
        ],
      },
    ],
  },
];

// ── API Functions ──────────────────────────────────────────────

/**
 * Resolves GET run for the UI: tries stored `kognitos_runs` via `/api/kognitos/runs/:id`, then mock data.
 */
export async function getRun(runId: string): Promise<KognitosRun | null> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(
        `/api/kognitos/runs/${encodeURIComponent(runId)}`,
      );
      if (res.ok) {
        const json = (await res.json()) as { run?: KognitosRun | null };
        if (json.run) return json.run;
      }
    } catch {
      /* fall through to mock */
    }
  }
  await Promise.resolve();
  const run = mockRuns.find(
    (r) =>
      r.name.endsWith(`/runs/${runId}`) || r.name.split("/").pop() === runId
  );
  return run ?? null;
}

/** Simulates GET /api/v1/.../runs */
export async function listRuns(options?: {
  pageSize?: number;
  filter?: string;
}): Promise<{ runs: KognitosRun[]; nextPageToken: string | null }> {
  await Promise.resolve();
  const pageSize = Math.min(options?.pageSize ?? 10, 1000);
  let filtered = [...mockRuns];

  if (options?.filter) {
    filtered = applyRunsFilter(filtered, options.filter);
  }

  const runs = filtered.slice(0, pageSize);
  const nextPageToken =
    filtered.length > pageSize ? `page-${pageSize}` : null;

  return { runs, nextPageToken };
}

/** Simulates GET /api/v1/.../runs/{run_id}/events */
export async function getRunEvents(
  runId: string,
  options?: { pageSize?: number; filter?: string }
): Promise<{ runEvents: KognitosRunEvent[]; nextPageToken: string | null }> {
  await Promise.resolve();
  const pageSize = Math.min(options?.pageSize ?? 100, 1000);
  let filtered = mockRunEvents.filter(
    (e) => e.runId === runId || e.runId.endsWith(`/runs/${runId}`)
  );

  if (options?.filter) {
    filtered = applyRunEventsFilter(filtered, options.filter);
  }

  const runEvents = filtered.slice(0, pageSize);
  const nextPageToken =
    filtered.length > pageSize ? `page-${pageSize}` : null;

  return { runEvents, nextPageToken };
}

/** Simulates GET /api/v1/.../dashboards:queryInsights */
export async function queryInsights(): Promise<KognitosInsights> {
  await Promise.resolve();
  return mockInsights;
}

/** Simulates GET /api/v1/.../metrics:query */
export async function queryMetrics(options?: {
  metrics?: string[];
  groupBy?: string[];
  interval?: string;
}): Promise<{ results: KognitosMetricResult[] }> {
  await Promise.resolve();
  let results = [...mockMetricResults];

  if (options?.metrics?.length) {
    results = results.filter((r) => options.metrics!.includes(r.metric));
  }
  if (options?.interval) {
    results = results.map((r) => ({ ...r, interval: options.interval! }));
  }

  return { results };
}

/** Simulates GET /api/v1/.../workspaces:automationRunAggregates */
export async function getAutomationRunAggregates(): Promise<{
  automationRunAggregates: {
    automationId: string;
    stats: { totalRuns: number; completedRuns: number };
  }[];
}> {
  await Promise.resolve();
  const total = mockRuns.length;
  const completed = mockRuns.filter((r) => r.state.completed).length;

  // CUSTOMIZE: Map your SOP stage names to automation IDs here.
  return {
    automationRunAggregates: [
      {
        automationId: "review-request",
        stats: { totalRuns: total, completedRuns: completed },
      },
      {
        automationId: "escalate-request",
        stats: { totalRuns: 1, completedRuns: 1 },
      },
    ],
  };
}

// ── Helpers ────────────────────────────────────────────────────

function applyRunsFilter(
  runs: KognitosRun[],
  filter: string
): KognitosRun[] {
  const createTimeGte = filter.match(/create_time\s*>=\s*"([^"]+)"/)?.[1];
  const createTimeLte = filter.match(/create_time\s*<=\s*"([^"]+)"/)?.[1];
  if (createTimeGte || createTimeLte) {
    return runs.filter((r) => {
      const t = new Date(r.createTime).getTime();
      if (createTimeGte && t < new Date(createTimeGte).getTime()) return false;
      if (createTimeLte && t > new Date(createTimeLte).getTime()) return false;
      return true;
    });
  }
  return runs;
}

function applyRunEventsFilter(
  events: KognitosRunEvent[],
  filter: string
): KognitosRunEvent[] {
  const nodeKindMatch = filter.match(/node_kind\s*=\s*"([^"]+)"/)?.[1];
  if (nodeKindMatch) {
    return events.filter((e) => e.nodeKind === nodeKindMatch);
  }
  return events;
}
