/**
 * Domain types for the workflow template app.
 *
 * Example domain: "Approval Requests" — submit, review, approve/reject.
 *
 * Look for CUSTOMIZE comments to adapt these types to your own domain.
 */

// ── Status & Enum Types ────────────────────────────────────────

/** CUSTOMIZE: Define the lifecycle statuses for your core entity. */
export type RequestStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "closed";

/** CUSTOMIZE: Define the roles users can have in your workflow. */
export type UserRole = "requester" | "reviewer" | "manager" | "admin";

/** CUSTOMIZE: Add or change priority levels as needed. */
export type Priority = "urgent" | "standard";

// ── Core Domain Models ─────────────────────────────────────────

/** CUSTOMIZE: Organization fields for multi-tenancy. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
}

/** CUSTOMIZE: Add or remove fields to match your user model. */
export interface User {
  id: string;
  org_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
}

/**
 * The core workflow entity.
 * CUSTOMIZE: Rename this interface and adjust fields for your domain
 * (e.g. "Ticket", "Order", "Claim").
 */
export interface Request {
  id: string;
  org_id: string;
  title: string;
  description: string;
  requester_id: string;
  assigned_to: string | null;
  status: RequestStatus;
  priority: Priority;
  /** CUSTOMIZE: Replace with your own category taxonomy. */
  category: string;
  /** CUSTOMIZE: Numeric value relevant to your domain (cost, estimate, etc.). */
  estimated_value: number;
  submitted_at: string | null;
  decided_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  kognitos_run_id: string;
  episode_id: string | null;
}

/** CUSTOMIZE: Adjust document metadata fields for your domain. */
export interface Document {
  id: string;
  request_id: string;
  file_name: string;
  document_type: string;
  size_bytes: number;
  source: string;
  created_at: string;
}

/** CUSTOMIZE: Add fields like visibility, edited_at, etc. */
export interface Comment {
  id: string;
  request_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

/** CUSTOMIZE: Expand the details payload to suit your audit needs. */
export interface AuditEvent {
  id: string;
  request_id: string;
  action: string;
  actor_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** CUSTOMIZE: Add channels (email, push) or priority to notifications. */
export interface Notification {
  id: string;
  user_id: string;
  request_id: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

/**
 * A business rule that can be evaluated against requests.
 * CUSTOMIZE: Adjust fields to match your rules engine.
 */
export interface Rule {
  id: string;
  name: string;
  description: string;
  category: string;
  is_active: boolean;
  /** CUSTOMIZE: Structured criteria expression (JSON, DSL, etc.). */
  criteria: string;
  created_at: string;
  updated_at: string;
}

// ── Kognitos Integration Types ─────────────────────────────────
// These stay the same across domains — they map to the Kognitos API.

export interface KognitosRun {
  name: string;
  createTime: string;
  updateTime: string;
  state: {
    pending?: Record<string, never>;
    executing?: Record<string, never>;
    awaitingGuidance?: { exception: string; description: string };
    completed?: { outputs: Record<string, string> };
    failed?: { id: string; description: string };
  };
  stage: string;
  stageVersion: string;
  invocationDetails: {
    invocationSource: string;
  };
  userInputs: Record<string, string>;
}

export interface KognitosRunEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: "runUpdate" | "executionJournal";
  nodeKind?: string;
  description: string;
  details?: Record<string, unknown>;
}

export interface KognitosInsights {
  valueInsight: {
    totalMoneySavedUsd: string;
    totalTimeSavedSecs: number;
  };
  runInsight: {
    totalRunsCount: number;
    trend: { percentChange: number; comparisonWindow: string };
  };
  completionInsight: {
    totalPercentCompletions: number;
    stp: number;
    completionsPerPeriod: {
      windowLabel: string;
      autoCompletedCount: number;
      manuallyResolvedCount: number;
    }[];
  };
  awaitingGuidanceInsight: {
    totalRunsAwaitingGuidance: number;
  };
}

export interface KognitosMetricSeries {
  tags: Record<string, string>;
  points: { startTime: string; value: number; windowLabel: string }[];
}

export interface KognitosMetricResult {
  metric: string;
  interval: string;
  series: KognitosMetricSeries[];
}

// ── Mock Users ─────────────────────────────────────────────────

/**
 * CUSTOMIZE: Update these mock users to match your own roles and org.
 * Used for local development and demo mode when Supabase is not configured.
 */
export const MOCK_USERS: Record<UserRole, User> = {
  requester: {
    id: "usr_001",
    org_id: "org_001",
    full_name: "Alice Johnson",
    email: "alice.johnson@example.com",
    role: "requester",
    avatar_url: "",
    created_at: "2025-01-15T08:00:00Z",
  },
  reviewer: {
    id: "usr_002",
    org_id: "org_001",
    full_name: "Bob Martinez",
    email: "bob.martinez@example.com",
    role: "reviewer",
    avatar_url: "",
    created_at: "2025-01-15T08:00:00Z",
  },
  manager: {
    id: "usr_003",
    org_id: "org_001",
    full_name: "Carol Williams",
    email: "carol.williams@example.com",
    role: "manager",
    avatar_url: "",
    created_at: "2025-01-15T08:00:00Z",
  },
  admin: {
    id: "usr_004",
    org_id: "org_001",
    full_name: "David Chen",
    email: "david.chen@example.com",
    role: "admin",
    avatar_url: "",
    created_at: "2025-01-15T08:00:00Z",
  },
};
