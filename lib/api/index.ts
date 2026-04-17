/**
 * Barrel re-export for the API layer.
 *
 * CUSTOMIZE: Add or remove module re-exports as you add new entity APIs.
 */

export {
  listRequests,
  getRequestById,
  getDocumentsForRequest,
  getCommentsForRequest,
  getAuditEventsForRequest,
} from "./requests";

export {
  listUsers,
  getUserById,
  getUserForRole,
} from "./users";

export {
  listRules,
  getRuleById,
} from "./rules";

export {
  getNotificationsForUser,
} from "./notifications";

export {
  queryInsights,
  queryMetrics,
  getRun,
  listRuns,
  getRunEvents,
  getAutomationRunAggregates,
} from "@/lib/kognitos";
