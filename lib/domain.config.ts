/**
 * Central domain configuration.
 *
 * CUSTOMIZE THIS FILE to adapt the template for your domain.
 * Every generic component (sidebar, topbar, status-badge, worklist-filters,
 * login, role-permissions) reads from this config.
 */

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning";

export interface StatusConfig {
  value: string;
  label: string;
  variant: BadgeVariant;
}

export interface RoleConfig {
  value: string;
  label: string;
  defaultPath: string;
  allowedPaths: string[] | ["*"];
  actions: string[] | ["*"];
}

export interface NavItem {
  label: string;
  /**
   * Destination for this nav item. Omit (or leave empty) for **group
   * placeholders** that exist only to host `children` and should not be
   * clickable themselves (e.g. a "test" header above experimental sub-pages).
   */
  href?: string;
  icon: string; // Lucide icon name
  roles?: string[]; // if set, only these roles see it; omit for all
  /** Indented links shown under this item (e.g. Worklist → Test). */
  children?: NavItem[];
}

export const DOMAIN = {
  // ── App identity ──────────────────────────────────────────────
  appName: "WorkflowApp",
  appDescription: "Workflow Management Platform",
  appLogo: "Layers", // Lucide icon name
  entitySlug: "requests", // used in URLs: /requests/[id]

  entity: {
    singular: "Request",
    plural: "Requests",
  },

  // ── Statuses ──────────────────────────────────────────────────
  statuses: [
    { value: "draft", label: "Draft", variant: "secondary" },
    { value: "submitted", label: "Submitted", variant: "default" },
    { value: "under_review", label: "Under Review", variant: "warning" },
    { value: "approved", label: "Approved", variant: "success" },
    { value: "rejected", label: "Rejected", variant: "destructive" },
    { value: "closed", label: "Closed", variant: "outline" },
  ] satisfies StatusConfig[],

  terminalStatuses: ["approved", "rejected", "closed"],

  // ── Priorities ────────────────────────────────────────────────
  priorities: [
    { value: "urgent", label: "Urgent" },
    { value: "standard", label: "Standard" },
  ],

  // ── Roles ─────────────────────────────────────────────────────
  roles: [
    {
      value: "requester",
      label: "Requester",
      defaultPath: "/",
      allowedPaths: [
        "/",
        "/worklist",
        "/requests",
        "/vendors",
        "/expert-queue",
        "/exception-handling",
        "/exception-handling-v2",
        "/logistics",
        "/notifications",
        "/setup-pending",
        "/developer",
      ],
      actions: ["create", "submit"],
    },
    {
      value: "reviewer",
      label: "Reviewer",
      defaultPath: "/",
      allowedPaths: [
        "/",
        "/worklist",
        "/requests",
        "/vendors",
        "/expert-queue",
        "/exception-handling",
        "/exception-handling-v2",
        "/logistics",
        "/rules",
        "/notifications",
        "/setup-pending",
        "/developer",
      ],
      actions: ["approve", "reject", "assign", "escalate"],
    },
    {
      value: "manager",
      label: "Manager",
      defaultPath: "/dashboard",
      allowedPaths: [
        "/",
        "/dashboard",
        "/worklist",
        "/vendors",
        "/expert-queue",
        "/exception-handling",
        "/exception-handling-v2",
        "/logistics",
        "/rules",
        "/notifications",
        "/settings",
        "/setup-pending",
        "/developer",
      ],
      actions: ["assign"],
    },
    {
      value: "admin",
      label: "Admin",
      defaultPath: "/dashboard",
      allowedPaths: ["*"],
      actions: ["*"],
    },
  ] satisfies RoleConfig[],

  // ── Navigation ────────────────────────────────────────────────
  navItems: [
    { label: "Dashboard", href: "/dashboard", icon: "Grid2x2" },
    { label: "Expert Queue", href: "/expert-queue", icon: "Users" },
    {
      label: "Exceptions",
      href: "/exception-handling",
      icon: "TriangleAlert",
    },
    {
      label: "Exceptions v2",
      href: "/exception-handling-v2",
      icon: "Sparkles",
    },
    {
      label: "test",
      icon: "FlaskConical",
      children: [
        {
          label: "doc-preview",
          href: "/exception-handling-v2/doc-preview",
          icon: "FileText",
        },
        {
          label: "chat",
          href: "/exception-handling-v2/chat",
          icon: "FileText",
        },
        {
          label: "B-Automation",
          href: "/vendors",
          icon: "Truck",
        },
        {
          label: "Developer",
          href: "/developer",
          icon: "Code2",
        },
      ],
    },
    { label: "Rules", href: "/rules", icon: "List" },
    { label: "Worklist", href: "/", icon: "ClipboardCheck" },
    { label: "Notifications", href: "/notifications", icon: "Bell" },
    { label: "Settings", href: "/settings", icon: "Settings", roles: ["admin", "manager"] },
  ] satisfies NavItem[],
} as const;

// ── Derived helpers ─────────────────────────────────────────────

export function getStatusConfig(value: string): StatusConfig | undefined {
  return (DOMAIN.statuses as readonly StatusConfig[]).find((s) => s.value === value);
}

export function getRoleConfig(value: string): RoleConfig | undefined {
  return (DOMAIN.roles as readonly RoleConfig[]).find((r) => r.value === value);
}
