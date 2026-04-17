# Customizing the Workflow Template

This guide walks you through adapting this template for your specific domain. Follow the steps in order — each step builds on the previous one.

By the end, you'll have a fully branded workflow app with your own entity types, database schema, business logic, and role-based access control.

---

## Step 1: Define Your Domain (`lib/domain.config.ts`)

This single file controls most of the generic UI. Start here.

**What to change:**

- `appName` — your application's display name
- `appDescription` — shown on the login page and metadata
- `appLogo` — a [Lucide icon](https://lucide.dev) name for the sidebar
- `entitySlug` — used in URLs (e.g., `"claims"` → `/claims/[id]`)
- `entity.singular` / `entity.plural` — used in page titles, buttons, and empty states
- `statuses` — the lifecycle states of your entity, with badge colors
- `terminalStatuses` — which statuses mean "done" (no more actions)
- `priorities` — urgency levels
- `roles` — user roles with their permissions, default paths, and allowed actions
- `navItems` — sidebar navigation, optionally gated by role

**Example — adapting for invoice approval:**

```typescript
export const DOMAIN = {
  appName: "InvoiceFlow",
  appDescription: "Invoice Approval Platform",
  appLogo: "Receipt",
  entitySlug: "invoices",

  entity: {
    singular: "Invoice",
    plural: "Invoices",
  },

  statuses: [
    { value: "draft", label: "Draft", variant: "secondary" },
    { value: "pending_approval", label: "Pending Approval", variant: "warning" },
    { value: "approved", label: "Approved", variant: "success" },
    { value: "rejected", label: "Rejected", variant: "destructive" },
    { value: "paid", label: "Paid", variant: "outline" },
  ] satisfies StatusConfig[],

  terminalStatuses: ["approved", "rejected", "paid"],

  roles: [
    {
      value: "submitter",
      label: "Submitter",
      defaultPath: "/",
      allowedPaths: ["/", "/invoices", "/notifications"],
      actions: ["create", "submit"],
    },
    {
      value: "approver",
      label: "Approver",
      defaultPath: "/",
      allowedPaths: ["/", "/invoices", "/rules", "/notifications"],
      actions: ["approve", "reject", "escalate"],
    },
    // ...
  ] satisfies RoleConfig[],

  navItems: [
    { label: "Worklist", href: "/", icon: "ClipboardList" },
    { label: "Dashboard", href: "/dashboard", icon: "BarChart3" },
    { label: "Policies", href: "/rules", icon: "BookOpen" },
    { label: "Notifications", href: "/notifications", icon: "Bell" },
    { label: "Settings", href: "/settings", icon: "Settings", roles: ["admin"] },
  ] satisfies NavItem[],
} as const;
```

---

## Step 2: Define Your Types (`lib/types.ts`)

Replace the example `Request` type with your domain entity. Keep the Kognitos types unchanged — they're standard across all domains.

**What to change:**

- `EntityStatus` union — must match the `value` fields in `domain.config.ts` statuses
- `UserRole` union — must match the `value` fields in `domain.config.ts` roles
- `Priority` union — must match `domain.config.ts` priorities
- Core entity interface — your main domain object (the "case" equivalent)
- Related entity interfaces — documents, line items, audit events, etc.

**Example:**

```typescript
export type EntityStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid";

export type UserRole = "submitter" | "approver" | "manager" | "admin";

export interface Invoice {
  id: string;
  org_id: string;
  vendor_name: string;
  vendor_id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  due_date: string;
  status: EntityStatus;
  priority: Priority;
  assigned_to: string | null;
  kognitos_run_id: string;
  created_at: string;
  updated_at: string;
}

export interface LineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}
```

**Keep unchanged:**

- `KognitosRun`, `KognitosRunEvent`, `KognitosInsights`, `KognitosMetricResult` — these mirror the Kognitos REST API
- `User` interface — just update the `role` field type
- `MOCK_USERS` — update with your role values

---

## Step 3: Create Your Database Schema (`supabase/migrations/`)

Map your TypeScript types to PostgreSQL tables. Create a new migration file or edit the existing `00000000000000_init_schema.sql`.

**Guidelines:**

- Use `CREATE TYPE` for status and role enums — must match your TypeScript unions
- Use `text` primary keys matching the TypeScript `id` field
- Use `jsonb` for flexible nested objects
- Add foreign key constraints for all relationships
- Create indexes on frequently filtered columns (`status`, `assigned_to`, etc.)
- Enable Row Level Security on all tables

**Example:**

```sql
CREATE TYPE entity_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'rejected', 'paid'
);

CREATE TABLE invoices (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations(id),
  vendor_name     text NOT NULL,
  vendor_id       text NOT NULL,
  invoice_number  text NOT NULL,
  amount          numeric(12, 2) NOT NULL,
  currency        text NOT NULL DEFAULT 'USD',
  due_date        date NOT NULL,
  status          entity_status NOT NULL DEFAULT 'draft',
  priority        priority NOT NULL DEFAULT 'standard',
  assigned_to     text REFERENCES users(id),
  kognitos_run_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_assigned ON invoices(assigned_to);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON invoices FOR SELECT USING (true);
```

After editing, push to Supabase:

```bash
npx supabase db push
```

---

## Step 4: Create Seed Data (`lib/seed-data/`)

Create realistic test data for development. Each entity type gets its own `.ts` file exporting a typed array.

**Guidelines:**

- Cover every status in the lifecycle (at least 3–5 records per status)
- Ensure foreign keys are consistent (entity → user, entity → related records)
- Every entity should have a `kognitos_run_id` linking to a mock run
- Include realistic dates, names, and values
- Aim for 20–60 records per entity type

**Example:**

```typescript
// lib/seed-data/invoices.ts
import type { Invoice } from "@/lib/types";

export const invoices: Invoice[] = [
  {
    id: "inv-001",
    org_id: "org-1",
    vendor_name: "Acme Supplies",
    vendor_id: "vendor-1",
    invoice_number: "INV-2026-0001",
    amount: 15250.00,
    currency: "USD",
    due_date: "2026-04-15",
    status: "approved",
    priority: "standard",
    assigned_to: "user-2",
    kognitos_run_id: "run-001",
    created_at: "2026-02-20T09:00:00Z",
    updated_at: "2026-02-22T14:30:00Z",
  },
  // ... 20-60 records covering all statuses
];
```

Re-export from `lib/seed-data/index.ts` and update `scripts/seed.ts` to upsert your new tables in dependency order (parents before children).

---

## Step 5: Wire the Data Layer (`lib/db.ts`)

Add Supabase fetcher functions for each of your tables. Follow the existing pattern:

**Pattern:**

```typescript
// Full-table fetch
export async function getAllInvoices(): Promise<Invoice[]> {
  const { data, error } = await sb().from("invoices").select("*");
  if (error) throw error;
  return data as Invoice[];
}

// Single-record fetch
export async function getInvoiceById(id: string): Promise<Invoice | undefined> {
  const { data, error } = await sb()
    .from("invoices")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return undefined;
  return data as Invoice;
}

// Relational fetch
export async function getLineItemsByInvoiceId(invoiceId: string): Promise<LineItem[]> {
  const { data, error } = await sb()
    .from("line_items")
    .select("*")
    .eq("invoice_id", invoiceId);
  if (error) throw error;
  return data as LineItem[];
}
```

All functions are async and call Supabase directly. There is no mock-data fallback at runtime.

---

## Step 6: Add Analytics Queries (`lib/queries.ts`)

Write async query functions for your domain metrics. Every number on the dashboard must come from one of these functions.

**Pattern:**

```typescript
export async function queryAvgApprovalTime(): Promise<number> {
  const invoices = await getAllInvoices();
  const decided = invoices.filter((inv) => inv.decided_at && inv.submitted_at);
  if (decided.length === 0) return 0;
  const totalDays = decided.reduce((sum, inv) => {
    return sum + (new Date(inv.decided_at!).getTime() -
      new Date(inv.submitted_at!).getTime()) / 86_400_000;
  }, 0);
  return totalDays / decided.length;
}

export async function queryStatusBreakdown(): Promise<{ status: string; count: number }[]> {
  const invoices = await getAllInvoices();
  const counts = new Map<string, number>();
  invoices.forEach((inv) => counts.set(inv.status, (counts.get(inv.status) ?? 0) + 1));
  return Array.from(counts, ([status, count]) => ({ status, count }));
}
```

Use `Promise.all` when a function needs data from multiple tables:

```typescript
export async function queryVendorPerformance() {
  const [invoices, vendors] = await Promise.all([
    getAllInvoices(),
    getAllVendors(),
  ]);
  // ... compute metrics from both arrays
}
```

---

## Step 7: Build the API Layer (`lib/api/`)

Create one module per entity that re-exports `lib/db` functions. This keeps a clean import boundary for pages.

**Pattern:**

```typescript
// lib/api/invoices.ts
export { getAllInvoices as listInvoices, getInvoiceById } from "@/lib/db";
```

Re-export everything from `lib/api/index.ts`:

```typescript
export { listInvoices, getInvoiceById } from "./invoices";
export { listUsers, getUserById, getUserForRole } from "./users";
export { queryInsights, queryMetrics, getRun, listRuns, getRunEvents } from "@/lib/kognitos";
```

Pages always import from `@/lib/api`, never from `@/lib/db` directly.

---

## Step 8: Create Kognitos SOPs (`lib/kognitos/client.ts`)

Define mock runs for your domain SOPs. Each run's `state.completed.outputs` should match the corresponding entity's data in the database, demonstrating that the SOP produced the values stored in your tables.

**Example:**

```typescript
const MOCK_RUNS: Record<string, KognitosRun> = {
  "run-001": {
    name: "workspaces/ws-1/automations/invoice-review/runs/run-001",
    createTime: "2026-02-20T09:05:00Z",
    updateTime: "2026-02-20T09:08:00Z",
    state: {
      completed: {
        outputs: {
          decision: "approved",
          compliance_check: "passed",
          duplicate_check: "no_duplicates",
          amount_validated: "true",
        },
      },
    },
    stage: "invoice-review-sop",
    stageVersion: "1.0.0",
    invocationDetails: { invocationSource: "api" },
    userInputs: {
      invoice_id: "inv-001",
      vendor_id: "vendor-1",
      amount: "15250.00",
    },
  },
  // ... one run per entity
};
```

Map one run per major workflow step (e.g., validation, compliance check, approval decision).

---

## Step 9: Configure RBAC (`lib/role-permissions.ts`)

RBAC is already config-driven — it reads from `domain.config.ts`. If you updated your roles in Step 1, the permission system picks them up automatically.

The module provides three functions used throughout the app:

- `canAccessPath(role, path)` — gates sidebar items and page access
- `canPerformAction(role, action)` — gates entity action buttons
- `getDefaultPath(role)` — determines where to redirect after login

You generally don't need to edit this file unless you need custom permission logic beyond what the config supports.

---

## Step 10: Customize Pages

With the data layer in place, update the UI components:

### Worklist (`components/worklist/worklist-table.tsx`)

Update the TanStack Table column definitions to match your entity fields:

```typescript
const columns: ColumnDef<Invoice>[] = [
  { accessorKey: "invoice_number", header: "Invoice #" },
  { accessorKey: "vendor_name", header: "Vendor" },
  { accessorKey: "amount", header: "Amount", cell: ({ row }) => formatCurrency(row.original.amount) },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  { accessorKey: "due_date", header: "Due Date", cell: ({ row }) => format(new Date(row.original.due_date), "MMM d, yyyy") },
];
```

### Entity Detail (`app/(dashboard)/[entity]/[id]/page.tsx`)

Add domain-specific tabs and fields. The tab structure is flexible — add, remove, or rename tabs as needed:

- **Overview**: Key information cards, checklist items, recommendations
- **Documents**: Attached files with type badges
- **Timeline**: Chronological audit log
- **SOP Run**: Kognitos run visibility (keep this — it shows your SOP execution)

### Dashboard (`app/(dashboard)/dashboard/page.tsx`)

Replace KPI cards and charts with your domain metrics. Wire each card to a query function from `lib/queries.ts`:

```typescript
const [avgTime, statusBreakdown, vendorPerf] = await Promise.all([
  queryAvgApprovalTime(),
  queryStatusBreakdown(),
  queryVendorPerformance(),
]);
```

### Domain Components (`components/domain/`)

Create domain-specific components for badges, cards, and displays that are unique to your workflow:

- `status-badge.tsx` — already reads from `domain.config.ts`
- `priority-badge.tsx` — already generic
- Add new components as needed (e.g., `vendor-card.tsx`, `amount-display.tsx`)

---

## Step 11: Deploy

### 1. Create a Supabase Project

If you haven't already, create a project at [supabase.com](https://supabase.com).

### 2. Push the Schema

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

### 3. Seed Production Data (Optional)

```bash
SUPABASE_SERVICE_ROLE_KEY=your-key npx tsx scripts/seed.ts
```

### 4. Set Vercel Environment Variables

In your Vercel project settings, add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |

Or enable the [Supabase Vercel Integration](https://vercel.com/integrations/supabase) to inject these automatically.

### 5. Deploy

```bash
vercel --prod
```

---

## Checklist

Use this checklist to track your progress:

- [ ] Updated `lib/domain.config.ts` with your domain
- [ ] Defined types in `lib/types.ts`
- [ ] Created database schema in `supabase/migrations/`
- [ ] Created seed data in `lib/seed-data/`
- [ ] Wired data layer in `lib/db.ts`
- [ ] Added analytics queries in `lib/queries.ts`
- [ ] Built API layer in `lib/api/`
- [ ] Created Kognitos mock SOPs in `lib/kognitos/client.ts`
- [ ] Verified RBAC works with your roles
- [ ] Customized worklist columns
- [ ] Customized entity detail tabs
- [ ] Customized dashboard KPIs and charts
- [ ] Pushed schema to Supabase
- [ ] Seeded the database
- [ ] Deployed to Vercel
