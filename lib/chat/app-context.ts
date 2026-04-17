import type { ChatConfig } from "./types";

/**
 * App-specific chat context injected into the Claude system prompt.
 *
 * CUSTOMIZE THIS FILE for your domain. Describe your tables, business rules,
 * and example questions so Claude can answer accurately.
 */
export const APP_CHAT_CONFIG: ChatConfig = {
  appName: "WorkflowApp",
  appDescription: "Workflow Management Platform for approval requests and task tracking",
  domainContext: `
This is a workflow management application. Here is what each table represents:

- organizations: Organizations using the platform.
- users: Staff members. Roles include: requester, reviewer, manager, admin.
- requests: The core entity — approval requests that go through a workflow.
  Status lifecycle: draft → submitted → under_review → approved / rejected → closed.
  Each request has a title, description, priority, and category.
- documents: Files attached to requests (supporting documents, evidence, etc.).
- comments: Free-text comments on requests by staff.
- audit_events: Immutable audit trail of every action taken on a request (who did what, when).
- notifications: Per-user notifications about request events and SLA breaches.
- rules: Business rules and SOPs that govern the approval process.

Common questions users ask:
- How many requests are in each status?
- Which requests have been under_review for more than 3 days?
- Show me requests assigned to a specific user.
- What is the breakdown by category?
- How many audit events were created today?
- Show me all rejected requests this month.
`.trim(),
};
