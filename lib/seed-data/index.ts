// Seed data for the Approval Requests workflow template

// ── Organization ───────────────────────────────────────────────

export const organizations = [
  {
    id: "org-1",
    name: "Acme Corporation",
    slug: "acme-corp",
    created_at: "2026-01-02T09:00:00Z",
  },
];

// ── Users ──────────────────────────────────────────────────────

export const users = [
  {
    id: "user-1",
    org_id: "org-1",
    full_name: "Alice Johnson",
    email: "alice.johnson@acme.com",
    role: "requester",
    avatar_url: null,
    created_at: "2026-01-03T10:00:00Z",
  },
  {
    id: "user-2",
    org_id: "org-1",
    full_name: "Bob Smith",
    email: "bob.smith@acme.com",
    role: "reviewer",
    avatar_url: null,
    created_at: "2026-01-03T10:05:00Z",
  },
  {
    id: "user-3",
    org_id: "org-1",
    full_name: "Carol Williams",
    email: "carol.williams@acme.com",
    role: "manager",
    avatar_url: null,
    created_at: "2026-01-03T10:10:00Z",
  },
  {
    id: "user-4",
    org_id: "org-1",
    full_name: "George Williams",
    email: "george.williams@acme.com",
    role: "admin",
    avatar_url: null,
    created_at: "2026-01-03T10:15:00Z",
  },
];

// ── Rules ──────────────────────────────────────────────────────

export const rules = [
  {
    id: "rule-1",
    name: "Budget Approval Policy",
    description:
      "All purchase requests exceeding $5,000 require manager-level approval. Requests above $25,000 require VP sign-off.",
    category: "budget",
    is_active: true,
    criteria:
      "estimated_value > 5000 => manager approval; estimated_value > 25000 => VP approval",
    created_at: "2026-01-05T08:00:00Z",
    updated_at: "2026-01-05T08:00:00Z",
  },
  {
    id: "rule-2",
    name: "Vendor Selection Criteria",
    description:
      "New vendor engagements must include at least two competitive bids and a completed vendor risk assessment form.",
    category: "procurement",
    is_active: true,
    criteria:
      "category IN (consulting, software) => require vendor_risk_assessment AND competitive_bids >= 2",
    created_at: "2026-01-05T08:30:00Z",
    updated_at: "2026-01-05T08:30:00Z",
  },
  {
    id: "rule-3",
    name: "Compliance Review Standard",
    description:
      "Any request involving external data sharing, regulated materials, or cross-border transactions must pass compliance review.",
    category: "compliance",
    is_active: true,
    criteria:
      "involves_external_data OR involves_regulated_materials OR is_cross_border => compliance_review_required",
    created_at: "2026-01-05T09:00:00Z",
    updated_at: "2026-02-10T14:00:00Z",
  },
];

// ── Kognitos automations (must match migration `00000000000005_kognitos_automations.sql`) ──

export const SEED_KOGNITOS_AUTOMATION_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

export const kognitosAutomations = [
  {
    id: SEED_KOGNITOS_AUTOMATION_ID,
    automation_id: "seed-automation",
    resource_name:
      "organizations/org-1/workspaces/ws-1/automations/seed-automation",
    display_name: "Seed automation",
    description: null as string | null,
    org_id: "org-1",
    created_at: "2026-01-02T09:00:00Z",
  },
];

// ── Kognitos runs (Supabase `kognitos_runs`; matches migration placeholders) ──

export const kognitosRuns = [
  {
    id: "run-1",
    kognitos_automation_id: SEED_KOGNITOS_AUTOMATION_ID,
    name: "workspaces/ws-1/runs/run-1",
    payload: {
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
    create_time: "2026-02-20T09:00:00Z",
    update_time: "2026-02-20T09:04:32Z",
  },
  {
    id: "run-2",
    kognitos_automation_id: SEED_KOGNITOS_AUTOMATION_ID,
    name: "workspaces/ws-1/runs/run-2",
    payload: {
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
    create_time: "2026-02-21T14:30:00Z",
    update_time: "2026-02-21T14:33:15Z",
  },
  {
    id: "run-3",
    kognitos_automation_id: SEED_KOGNITOS_AUTOMATION_ID,
    name: "workspaces/ws-1/runs/run-3",
    payload: {
      name: "workspaces/ws-1/runs/run-3",
      createTime: "2026-02-10T10:00:00Z",
      updateTime: "2026-02-15T11:00:00Z",
      state: { completed: { outputs: { status: "under_review" } } },
      stage: "review-request",
      stageVersion: "1.0",
      invocationDetails: { invocationSource: "api" },
      userInputs: {
        request_id: "req-6",
        title: "Datadog APM upgrade",
        category: "software",
      },
    },
    create_time: "2026-02-10T10:00:00Z",
    update_time: "2026-02-15T11:00:00Z",
  },
  {
    id: "run-4",
    kognitos_automation_id: SEED_KOGNITOS_AUTOMATION_ID,
    name: "workspaces/ws-1/runs/run-4",
    payload: {
      name: "workspaces/ws-1/runs/run-4",
      createTime: "2026-01-20T10:00:00Z",
      updateTime: "2026-01-28T15:00:00Z",
      state: { completed: { outputs: { status: "approved" } } },
      stage: "review-request",
      stageVersion: "1.0",
      invocationDetails: { invocationSource: "api" },
      userInputs: {
        request_id: "req-9",
        title: "AWS reserved instances",
        category: "software",
      },
    },
    create_time: "2026-01-20T10:00:00Z",
    update_time: "2026-01-28T15:00:00Z",
  },
  {
    id: "run-5",
    kognitos_automation_id: SEED_KOGNITOS_AUTOMATION_ID,
    name: "workspaces/ws-1/runs/run-5",
    payload: {
      name: "workspaces/ws-1/runs/run-5",
      createTime: "2026-01-05T09:00:00Z",
      updateTime: "2026-01-15T10:00:00Z",
      state: { completed: { outputs: { status: "closed" } } },
      stage: "review-request",
      stageVersion: "1.0",
      invocationDetails: { invocationSource: "api" },
      userInputs: {
        request_id: "req-14",
        title: "New laptop provisioning",
        category: "equipment",
      },
    },
    create_time: "2026-01-05T09:00:00Z",
    update_time: "2026-01-15T10:00:00Z",
  },
];

// ── Requests ───────────────────────────────────────────────────

export const requests = [
  // Draft (2)
  {
    id: "req-1",
    org_id: "org-1",
    title: "Standing desks for engineering team",
    description:
      "Purchase 8 electric standing desks for the engineering floor. Ergonomic assessment completed.",
    requester_id: "user-1",
    assigned_to: null,
    status: "draft",
    priority: "standard",
    category: "equipment",
    estimated_value: 4800,
    submitted_at: null,
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-20T09:00:00Z",
    updated_at: "2026-02-20T09:00:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },
  {
    id: "req-2",
    org_id: "org-1",
    title: "Team offsite in Portland",
    description:
      "Three-day strategy offsite for 12 product team members. Includes venue, meals, and travel.",
    requester_id: "user-1",
    assigned_to: null,
    status: "draft",
    priority: "standard",
    category: "travel",
    estimated_value: 18000,
    submitted_at: null,
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-25T11:30:00Z",
    updated_at: "2026-02-25T11:30:00Z",
    kognitos_run_id: null,
    episode_id: "ep-travel-q1",
  },

  // Submitted (3)
  {
    id: "req-3",
    org_id: "org-1",
    title: "Annual Figma Enterprise license renewal",
    description:
      "Renew Figma Enterprise plan for 25 seats. Current license expires March 31.",
    requester_id: "user-1",
    assigned_to: "user-2",
    status: "submitted",
    priority: "urgent",
    category: "software",
    estimated_value: 15000,
    submitted_at: "2026-02-18T14:00:00Z",
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-17T10:00:00Z",
    updated_at: "2026-02-18T14:00:00Z",
    kognitos_run_id: "run-1",
    episode_id: null,
  },
  {
    id: "req-4",
    org_id: "org-1",
    title: "External security audit – Q1",
    description:
      "Engage CyberShield Inc. for quarterly penetration testing and vulnerability assessment.",
    requester_id: "user-1",
    assigned_to: "user-2",
    status: "submitted",
    priority: "standard",
    category: "consulting",
    estimated_value: 22000,
    submitted_at: "2026-02-20T09:30:00Z",
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-19T16:00:00Z",
    updated_at: "2026-02-20T09:30:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },
  {
    id: "req-5",
    org_id: "org-1",
    title: "Office printer replacement",
    description:
      "Replace aging HP LaserJet on floor 3 with a new multifunction unit.",
    requester_id: "user-1",
    assigned_to: "user-2",
    status: "submitted",
    priority: "standard",
    category: "equipment",
    estimated_value: 2800,
    submitted_at: "2026-02-22T08:15:00Z",
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-21T15:00:00Z",
    updated_at: "2026-02-22T08:15:00Z",
    kognitos_run_id: "run-2",
    episode_id: null,
  },

  // Under Review (3)
  {
    id: "req-6",
    org_id: "org-1",
    title: "Datadog APM upgrade to Enterprise tier",
    description:
      "Upgrade Datadog from Pro to Enterprise for full distributed tracing and advanced analytics.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "under_review",
    priority: "urgent",
    category: "software",
    estimated_value: 36000,
    submitted_at: "2026-02-10T10:00:00Z",
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-09T14:00:00Z",
    updated_at: "2026-02-15T11:00:00Z",
    kognitos_run_id: "run-3",
    episode_id: "ep-infra-q1",
  },
  {
    id: "req-7",
    org_id: "org-1",
    title: "Conference room AV overhaul",
    description:
      "Install new displays, cameras, and microphones in three main conference rooms.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "under_review",
    priority: "standard",
    category: "facilities",
    estimated_value: 28500,
    submitted_at: "2026-02-12T09:00:00Z",
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-11T13:00:00Z",
    updated_at: "2026-02-16T10:30:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },
  {
    id: "req-8",
    org_id: "org-1",
    title: "Legal review – vendor MSA",
    description:
      "Outside counsel to review and redline master services agreement with CloudScale Technologies.",
    requester_id: "user-1",
    assigned_to: "user-2",
    status: "under_review",
    priority: "standard",
    category: "consulting",
    estimated_value: 8500,
    submitted_at: "2026-02-14T11:00:00Z",
    decided_at: null,
    closed_at: null,
    created_at: "2026-02-13T16:30:00Z",
    updated_at: "2026-02-17T09:00:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },

  // Approved (3)
  {
    id: "req-9",
    org_id: "org-1",
    title: "AWS reserved instances – 1yr commit",
    description:
      "Convert on-demand EC2 and RDS instances to 1-year reserved pricing. Projected 32% savings.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "approved",
    priority: "standard",
    category: "software",
    estimated_value: 50000,
    submitted_at: "2026-01-20T10:00:00Z",
    decided_at: "2026-01-28T15:00:00Z",
    closed_at: null,
    created_at: "2026-01-18T09:00:00Z",
    updated_at: "2026-01-28T15:00:00Z",
    kognitos_run_id: "run-4",
    episode_id: "ep-infra-q1",
  },
  {
    id: "req-10",
    org_id: "org-1",
    title: "Ergonomic keyboard batch order",
    description:
      "Order 20 split ergonomic keyboards for employees who completed the ergo assessment.",
    requester_id: "user-1",
    assigned_to: "user-2",
    status: "approved",
    priority: "standard",
    category: "equipment",
    estimated_value: 3400,
    submitted_at: "2026-02-01T09:00:00Z",
    decided_at: "2026-02-05T14:00:00Z",
    closed_at: null,
    created_at: "2026-01-30T11:00:00Z",
    updated_at: "2026-02-05T14:00:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },
  {
    id: "req-11",
    org_id: "org-1",
    title: "Marketing conference sponsorship – DevSummit 2026",
    description:
      "Gold-tier sponsorship for DevSummit 2026 including booth, 4 passes, and logo placement.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "approved",
    priority: "standard",
    category: "travel",
    estimated_value: 12000,
    submitted_at: "2026-01-25T10:00:00Z",
    decided_at: "2026-02-01T16:00:00Z",
    closed_at: null,
    created_at: "2026-01-24T14:00:00Z",
    updated_at: "2026-02-01T16:00:00Z",
    kognitos_run_id: null,
    episode_id: "ep-travel-q1",
  },

  // Rejected (2)
  {
    id: "req-12",
    org_id: "org-1",
    title: "Premium Slack plan upgrade",
    description:
      "Upgrade from Slack Pro to Business+ for enhanced compliance and DLP features.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "rejected",
    priority: "standard",
    category: "software",
    estimated_value: 9600,
    submitted_at: "2026-01-15T10:00:00Z",
    decided_at: "2026-01-22T11:30:00Z",
    closed_at: null,
    created_at: "2026-01-14T09:00:00Z",
    updated_at: "2026-01-22T11:30:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },
  {
    id: "req-13",
    org_id: "org-1",
    title: "Executive lounge renovation",
    description:
      "Full renovation of the 5th-floor executive lounge including furniture and lighting.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "rejected",
    priority: "standard",
    category: "facilities",
    estimated_value: 45000,
    submitted_at: "2026-01-10T10:00:00Z",
    decided_at: "2026-01-18T09:00:00Z",
    closed_at: null,
    created_at: "2026-01-09T11:00:00Z",
    updated_at: "2026-01-18T09:00:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },

  // Closed (2)
  {
    id: "req-14",
    org_id: "org-1",
    title: "New laptop provisioning – Q4 hires",
    description:
      "MacBook Pro M4 laptops for 5 new engineering hires starting January.",
    requester_id: "user-1",
    assigned_to: "user-2",
    status: "closed",
    priority: "urgent",
    category: "equipment",
    estimated_value: 15000,
    submitted_at: "2026-01-05T09:00:00Z",
    decided_at: "2026-01-08T14:00:00Z",
    closed_at: "2026-01-15T10:00:00Z",
    created_at: "2026-01-04T10:00:00Z",
    updated_at: "2026-01-15T10:00:00Z",
    kognitos_run_id: "run-5",
    episode_id: null,
  },
  {
    id: "req-15",
    org_id: "org-1",
    title: "Compliance training platform subscription",
    description:
      "Annual subscription to SafetyFirst for mandatory compliance and safety training modules.",
    requester_id: "user-1",
    assigned_to: "user-3",
    status: "closed",
    priority: "standard",
    category: "software",
    estimated_value: 5200,
    submitted_at: "2026-01-06T11:00:00Z",
    decided_at: "2026-01-10T16:00:00Z",
    closed_at: "2026-01-20T09:00:00Z",
    created_at: "2026-01-05T14:00:00Z",
    updated_at: "2026-01-20T09:00:00Z",
    kognitos_run_id: null,
    episode_id: null,
  },
];

// ── Documents ──────────────────────────────────────────────────

export const documents = [
  { id: "doc-1", request_id: "req-3", file_name: "figma_invoice_2026.pdf", document_type: "invoice", size_bytes: 245000, source: "manual_upload", created_at: "2026-02-17T10:30:00Z" },
  { id: "doc-2", request_id: "req-3", file_name: "figma_usage_report.xlsx", document_type: "report", size_bytes: 128000, source: "manual_upload", created_at: "2026-02-17T10:35:00Z" },
  { id: "doc-3", request_id: "req-4", file_name: "cybershield_proposal.pdf", document_type: "proposal", size_bytes: 890000, source: "manual_upload", created_at: "2026-02-19T16:30:00Z" },
  { id: "doc-4", request_id: "req-4", file_name: "security_audit_scope.docx", document_type: "scope_document", size_bytes: 56000, source: "manual_upload", created_at: "2026-02-19T16:45:00Z" },
  { id: "doc-5", request_id: "req-5", file_name: "printer_comparison.pdf", document_type: "comparison", size_bytes: 320000, source: "manual_upload", created_at: "2026-02-21T15:30:00Z" },
  { id: "doc-6", request_id: "req-6", file_name: "datadog_quote_enterprise.pdf", document_type: "quote", size_bytes: 410000, source: "manual_upload", created_at: "2026-02-09T14:30:00Z" },
  { id: "doc-7", request_id: "req-6", file_name: "apm_roi_analysis.xlsx", document_type: "analysis", size_bytes: 198000, source: "system_generated", created_at: "2026-02-10T08:00:00Z" },
  { id: "doc-8", request_id: "req-7", file_name: "av_vendor_bids.pdf", document_type: "proposal", size_bytes: 1240000, source: "manual_upload", created_at: "2026-02-11T13:30:00Z" },
  { id: "doc-9", request_id: "req-7", file_name: "conference_room_floor_plan.pdf", document_type: "blueprint", size_bytes: 2100000, source: "manual_upload", created_at: "2026-02-11T14:00:00Z" },
  { id: "doc-10", request_id: "req-8", file_name: "cloudscale_msa_draft.pdf", document_type: "contract", size_bytes: 780000, source: "manual_upload", created_at: "2026-02-13T17:00:00Z" },
  { id: "doc-11", request_id: "req-9", file_name: "aws_reserved_pricing.pdf", document_type: "quote", size_bytes: 350000, source: "manual_upload", created_at: "2026-01-18T09:30:00Z" },
  { id: "doc-12", request_id: "req-9", file_name: "cost_savings_projection.xlsx", document_type: "analysis", size_bytes: 165000, source: "system_generated", created_at: "2026-01-19T11:00:00Z" },
  { id: "doc-13", request_id: "req-10", file_name: "keyboard_catalog.pdf", document_type: "catalog", size_bytes: 540000, source: "manual_upload", created_at: "2026-01-30T11:30:00Z" },
  { id: "doc-14", request_id: "req-11", file_name: "devsummit_sponsorship_tiers.pdf", document_type: "proposal", size_bytes: 430000, source: "manual_upload", created_at: "2026-01-24T14:30:00Z" },
  { id: "doc-15", request_id: "req-13", file_name: "lounge_renovation_plan.pdf", document_type: "blueprint", size_bytes: 1890000, source: "manual_upload", created_at: "2026-01-09T11:30:00Z" },
  { id: "doc-16", request_id: "req-14", file_name: "macbook_order_form.pdf", document_type: "order_form", size_bytes: 120000, source: "manual_upload", created_at: "2026-01-04T10:30:00Z" },
  { id: "doc-17", request_id: "req-14", file_name: "it_asset_tracking.xlsx", document_type: "report", size_bytes: 87000, source: "system_generated", created_at: "2026-01-05T08:00:00Z" },
  { id: "doc-18", request_id: "req-15", file_name: "safetyfirst_proposal.pdf", document_type: "proposal", size_bytes: 560000, source: "manual_upload", created_at: "2026-01-05T14:30:00Z" },
  { id: "doc-19", request_id: "req-12", file_name: "slack_plan_comparison.pdf", document_type: "comparison", size_bytes: 290000, source: "manual_upload", created_at: "2026-01-14T09:30:00Z" },
  { id: "doc-20", request_id: "req-1", file_name: "standing_desk_ergonomic_report.pdf", document_type: "report", size_bytes: 175000, source: "manual_upload", created_at: "2026-02-20T09:15:00Z" },
];

// ── Comments ───────────────────────────────────────────────────

export const comments = [
  { id: "cmt-1", request_id: "req-3", author_id: "user-2", content: "Confirmed with finance — budget line available under SaaS renewals.", created_at: "2026-02-18T15:00:00Z" },
  { id: "cmt-2", request_id: "req-4", author_id: "user-2", content: "CyberShield is an approved vendor. SOW looks reasonable, forwarding to Carol for final sign-off.", created_at: "2026-02-20T10:00:00Z" },
  { id: "cmt-3", request_id: "req-6", author_id: "user-3", content: "The ROI analysis is compelling, but I want to verify the usage numbers against last quarter's metrics.", created_at: "2026-02-15T11:00:00Z" },
  { id: "cmt-4", request_id: "req-6", author_id: "user-1", content: "Updated usage data attached. Peak month was 40% over our Pro plan limits.", created_at: "2026-02-15T14:30:00Z" },
  { id: "cmt-5", request_id: "req-7", author_id: "user-3", content: "We need a third bid per procurement policy. Can you get a quote from AudioTech?", created_at: "2026-02-16T10:30:00Z" },
  { id: "cmt-6", request_id: "req-8", author_id: "user-2", content: "Legal flagged some liability concerns in section 7. Requesting a redline.", created_at: "2026-02-17T09:00:00Z" },
  { id: "cmt-7", request_id: "req-9", author_id: "user-3", content: "Approved. The savings justify the upfront commitment. Proceed with reservation.", created_at: "2026-01-28T15:00:00Z" },
  { id: "cmt-8", request_id: "req-10", author_id: "user-2", content: "All ergo assessments are on file. Approved for purchase.", created_at: "2026-02-05T14:00:00Z" },
  { id: "cmt-9", request_id: "req-12", author_id: "user-3", content: "Current Slack Pro meets our needs. The DLP features are available via our existing MDM. Rejecting.", created_at: "2026-01-22T11:30:00Z" },
  { id: "cmt-10", request_id: "req-13", author_id: "user-3", content: "This doesn't align with Q1 facilities budget. Resubmit for Q3 planning.", created_at: "2026-01-18T09:00:00Z" },
  { id: "cmt-11", request_id: "req-14", author_id: "user-2", content: "All laptops received and imaged. Closing request.", created_at: "2026-01-15T10:00:00Z" },
  { id: "cmt-12", request_id: "req-15", author_id: "user-3", content: "Subscription active. All employees enrolled. Closing.", created_at: "2026-01-20T09:00:00Z" },
  { id: "cmt-13", request_id: "req-5", author_id: "user-1", content: "Added a comparison of three models with pricing and features.", created_at: "2026-02-22T08:30:00Z" },
  { id: "cmt-14", request_id: "req-11", author_id: "user-1", content: "Early-bird pricing ends Feb 15 — we should lock in by then.", created_at: "2026-01-25T10:30:00Z" },
  { id: "cmt-15", request_id: "req-2", author_id: "user-1", content: "Still finalizing the venue options. Will submit once we have confirmations.", created_at: "2026-02-25T12:00:00Z" },
];

// ── Audit Events ───────────────────────────────────────────────

export const auditEvents = [
  // req-3 (submitted)
  { id: "evt-1", request_id: "req-3", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-18T14:00:00Z" },
  { id: "evt-2", request_id: "req-3", action: "assigned", actor_id: "user-4", details: { assigned_to: "user-2" }, created_at: "2026-02-18T14:05:00Z" },
  { id: "evt-3", request_id: "req-3", action: "document_uploaded", actor_id: "user-1", details: { document_id: "doc-1" }, created_at: "2026-02-17T10:30:00Z" },
  { id: "evt-4", request_id: "req-3", action: "document_uploaded", actor_id: "user-1", details: { document_id: "doc-2" }, created_at: "2026-02-17T10:35:00Z" },

  // req-4 (submitted)
  { id: "evt-5", request_id: "req-4", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-20T09:30:00Z" },
  { id: "evt-6", request_id: "req-4", action: "assigned", actor_id: "user-4", details: { assigned_to: "user-2" }, created_at: "2026-02-20T09:35:00Z" },
  { id: "evt-7", request_id: "req-4", action: "comment_added", actor_id: "user-2", details: { comment_id: "cmt-2" }, created_at: "2026-02-20T10:00:00Z" },

  // req-5 (submitted)
  { id: "evt-8", request_id: "req-5", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-22T08:15:00Z" },
  { id: "evt-9", request_id: "req-5", action: "document_uploaded", actor_id: "user-1", details: { document_id: "doc-5" }, created_at: "2026-02-21T15:30:00Z" },

  // req-6 (under_review)
  { id: "evt-10", request_id: "req-6", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-10T10:00:00Z" },
  { id: "evt-11", request_id: "req-6", action: "assigned", actor_id: "user-4", details: { assigned_to: "user-3" }, created_at: "2026-02-10T10:05:00Z" },
  { id: "evt-12", request_id: "req-6", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "under_review" }, created_at: "2026-02-12T09:00:00Z" },
  { id: "evt-13", request_id: "req-6", action: "comment_added", actor_id: "user-3", details: { comment_id: "cmt-3" }, created_at: "2026-02-15T11:00:00Z" },

  // req-7 (under_review)
  { id: "evt-14", request_id: "req-7", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-12T09:00:00Z" },
  { id: "evt-15", request_id: "req-7", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "under_review" }, created_at: "2026-02-14T10:00:00Z" },
  { id: "evt-16", request_id: "req-7", action: "comment_added", actor_id: "user-3", details: { comment_id: "cmt-5" }, created_at: "2026-02-16T10:30:00Z" },

  // req-8 (under_review)
  { id: "evt-17", request_id: "req-8", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-14T11:00:00Z" },
  { id: "evt-18", request_id: "req-8", action: "status_changed", actor_id: "user-2", details: { from: "submitted", to: "under_review" }, created_at: "2026-02-15T09:00:00Z" },

  // req-9 (approved)
  { id: "evt-19", request_id: "req-9", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-01-20T10:00:00Z" },
  { id: "evt-20", request_id: "req-9", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "under_review" }, created_at: "2026-01-22T09:00:00Z" },
  { id: "evt-21", request_id: "req-9", action: "status_changed", actor_id: "user-3", details: { from: "under_review", to: "approved" }, created_at: "2026-01-28T15:00:00Z" },
  { id: "evt-22", request_id: "req-9", action: "comment_added", actor_id: "user-3", details: { comment_id: "cmt-7" }, created_at: "2026-01-28T15:00:00Z" },

  // req-10 (approved)
  { id: "evt-23", request_id: "req-10", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-02-01T09:00:00Z" },
  { id: "evt-24", request_id: "req-10", action: "status_changed", actor_id: "user-2", details: { from: "submitted", to: "approved" }, created_at: "2026-02-05T14:00:00Z" },

  // req-11 (approved)
  { id: "evt-25", request_id: "req-11", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-01-25T10:00:00Z" },
  { id: "evt-26", request_id: "req-11", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "approved" }, created_at: "2026-02-01T16:00:00Z" },

  // req-12 (rejected)
  { id: "evt-27", request_id: "req-12", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-01-15T10:00:00Z" },
  { id: "evt-28", request_id: "req-12", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "under_review" }, created_at: "2026-01-17T09:00:00Z" },
  { id: "evt-29", request_id: "req-12", action: "status_changed", actor_id: "user-3", details: { from: "under_review", to: "rejected" }, created_at: "2026-01-22T11:30:00Z" },

  // req-13 (rejected)
  { id: "evt-30", request_id: "req-13", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-01-10T10:00:00Z" },
  { id: "evt-31", request_id: "req-13", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "rejected" }, created_at: "2026-01-18T09:00:00Z" },

  // req-14 (closed)
  { id: "evt-32", request_id: "req-14", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-01-05T09:00:00Z" },
  { id: "evt-33", request_id: "req-14", action: "status_changed", actor_id: "user-2", details: { from: "submitted", to: "approved" }, created_at: "2026-01-08T14:00:00Z" },
  { id: "evt-34", request_id: "req-14", action: "document_uploaded", actor_id: "user-2", details: { document_id: "doc-17" }, created_at: "2026-01-05T08:00:00Z" },
  { id: "evt-35", request_id: "req-14", action: "status_changed", actor_id: "user-2", details: { from: "approved", to: "closed" }, created_at: "2026-01-15T10:00:00Z" },

  // req-15 (closed)
  { id: "evt-36", request_id: "req-15", action: "status_changed", actor_id: "user-1", details: { from: "draft", to: "submitted" }, created_at: "2026-01-06T11:00:00Z" },
  { id: "evt-37", request_id: "req-15", action: "status_changed", actor_id: "user-3", details: { from: "submitted", to: "approved" }, created_at: "2026-01-10T16:00:00Z" },
  { id: "evt-38", request_id: "req-15", action: "status_changed", actor_id: "user-3", details: { from: "approved", to: "closed" }, created_at: "2026-01-20T09:00:00Z" },

  // req-1 (draft)
  { id: "evt-39", request_id: "req-1", action: "document_uploaded", actor_id: "user-1", details: { document_id: "doc-20" }, created_at: "2026-02-20T09:15:00Z" },

  // req-9 additional
  { id: "evt-40", request_id: "req-9", action: "document_uploaded", actor_id: "user-1", details: { document_id: "doc-12" }, created_at: "2026-01-19T11:00:00Z" },
];

// ── Notifications ──────────────────────────────────────────────

export const notifications = [
  { id: "notif-1", user_id: "user-2", request_id: "req-3", message: "You have been assigned to review: Annual Figma Enterprise license renewal", is_read: true, created_at: "2026-02-18T14:05:00Z" },
  { id: "notif-2", user_id: "user-2", request_id: "req-4", message: "You have been assigned to review: External security audit – Q1", is_read: true, created_at: "2026-02-20T09:35:00Z" },
  { id: "notif-3", user_id: "user-2", request_id: "req-5", message: "You have been assigned to review: Office printer replacement", is_read: false, created_at: "2026-02-22T08:20:00Z" },
  { id: "notif-4", user_id: "user-3", request_id: "req-6", message: "Request assigned for manager review: Datadog APM upgrade to Enterprise tier", is_read: true, created_at: "2026-02-10T10:05:00Z" },
  { id: "notif-5", user_id: "user-1", request_id: "req-6", message: "Carol Williams commented on your request: Datadog APM upgrade to Enterprise tier", is_read: true, created_at: "2026-02-15T11:00:00Z" },
  { id: "notif-6", user_id: "user-3", request_id: "req-7", message: "Request assigned for manager review: Conference room AV overhaul", is_read: true, created_at: "2026-02-12T09:05:00Z" },
  { id: "notif-7", user_id: "user-1", request_id: "req-9", message: "Your request has been approved: AWS reserved instances – 1yr commit", is_read: true, created_at: "2026-01-28T15:00:00Z" },
  { id: "notif-8", user_id: "user-1", request_id: "req-10", message: "Your request has been approved: Ergonomic keyboard batch order", is_read: true, created_at: "2026-02-05T14:00:00Z" },
  { id: "notif-9", user_id: "user-1", request_id: "req-12", message: "Your request has been rejected: Premium Slack plan upgrade", is_read: true, created_at: "2026-01-22T11:30:00Z" },
  { id: "notif-10", user_id: "user-1", request_id: "req-13", message: "Your request has been rejected: Executive lounge renovation", is_read: true, created_at: "2026-01-18T09:00:00Z" },
  { id: "notif-11", user_id: "user-1", request_id: "req-14", message: "Your request has been closed: New laptop provisioning – Q4 hires", is_read: true, created_at: "2026-01-15T10:00:00Z" },
  { id: "notif-12", user_id: "user-1", request_id: "req-15", message: "Your request has been closed: Compliance training platform subscription", is_read: true, created_at: "2026-01-20T09:00:00Z" },
  { id: "notif-13", user_id: "user-1", request_id: "req-7", message: "Carol Williams commented on your request: Conference room AV overhaul", is_read: false, created_at: "2026-02-16T10:30:00Z" },
  { id: "notif-14", user_id: "user-1", request_id: "req-8", message: "Bob Smith commented on your request: Legal review – vendor MSA", is_read: false, created_at: "2026-02-17T09:00:00Z" },
  { id: "notif-15", user_id: "user-4", request_id: null, message: "Weekly digest: 3 requests pending review, 2 approved this week", is_read: false, created_at: "2026-02-24T08:00:00Z" },
];
