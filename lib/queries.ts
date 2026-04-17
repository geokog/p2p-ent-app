/**
 * Async analytics query functions.
 *
 * All data is fetched from Supabase via lib/db and computed in JS.
 * CUSTOMIZE: Add, remove, or modify queries to match your domain metrics.
 */

import {
  getAllRequests,
  getAllNotifications,
  getAllRules,
} from "@/lib/db";

// CUSTOMIZE: Statuses that count as "decided" in your workflow.
const DECIDED_STATUSES = ["approved", "rejected"];

/**
 * Average number of days between submitted_at and decided_at
 * across all decided requests.
 */
export async function queryAvgTimeToDecision(): Promise<number> {
  const requests = await getAllRequests();
  const withDates = requests.filter((r) => r.decided_at && r.submitted_at);
  if (withDates.length === 0) return 0;
  const totalDays = withDates.reduce((sum, r) => {
    return (
      sum +
      (new Date(r.decided_at!).getTime() - new Date(r.submitted_at!).getTime()) /
        86_400_000
    );
  }, 0);
  return totalDays / withDates.length;
}

/** Percentage of decided requests that were approved. */
export async function queryApprovalRate(): Promise<number> {
  const requests = await getAllRequests();
  const decided = requests.filter((r) => DECIDED_STATUSES.includes(r.status));
  if (decided.length === 0) return 0;
  const approved = decided.filter((r) => r.status === "approved");
  return (approved.length / decided.length) * 100;
}

/** Percentage of decided requests that were rejected. */
export async function queryRejectionRate(): Promise<number> {
  const requests = await getAllRequests();
  const decided = requests.filter((r) => DECIDED_STATUSES.includes(r.status));
  if (decided.length === 0) return 0;
  const rejected = decided.filter((r) => r.status === "rejected");
  return (rejected.length / decided.length) * 100;
}

/** Count of requests grouped by status. */
export async function queryStatusBreakdown(): Promise<
  { status: string; count: number }[]
> {
  const requests = await getAllRequests();
  const counts: Record<string, number> = {};
  for (const r of requests) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

/** Number of unread notifications for a given user. */
export async function queryUnreadNotificationCount(
  userId: string,
): Promise<number> {
  const notifs = await getAllNotifications();
  return notifs.filter((n) => n.user_id === userId && !n.is_read).length;
}

/**
 * Count of requests grouped by category.
 * CUSTOMIZE: Replace "category" with whatever grouping field you use.
 */
export async function queryCategoryBreakdown(): Promise<
  { category: string; count: number }[]
> {
  const requests = await getAllRequests();
  const counts: Record<string, number> = {};
  for (const r of requests) {
    const cat = r.category || "Uncategorized";
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * For a given rule, compute:
 * - hit_rate: fraction of all requests where this rule's category matches
 * - approval_rate: fraction of hit requests that were approved
 *
 * CUSTOMIZE: Adjust matching logic to suit your rules engine.
 */
export async function queryRuleMetrics(
  ruleId: string,
): Promise<{ hit_rate: number; approval_rate: number }> {
  const [requests, rules] = await Promise.all([
    getAllRequests(),
    getAllRules(),
  ]);

  const rule = rules.find((r) => r.id === ruleId);
  if (!rule || requests.length === 0) return { hit_rate: 0, approval_rate: 0 };

  const hitRequests = requests.filter((r) => r.category === rule.category);
  const hit_rate = hitRequests.length / requests.length;

  const decided = hitRequests.filter((r) =>
    DECIDED_STATUSES.includes(r.status),
  );
  const approved = decided.filter((r) => r.status === "approved");
  const approval_rate = decided.length > 0 ? approved.length / decided.length : 0;

  return { hit_rate, approval_rate };
}
