# Application Blueprint: Kognitos-Powered Workflow Application

A complete set of instructions for building a domain-specific workflow application with a Next.js presentation layer and Kognitos "English as Code" business logic. This blueprint is domain-agnostic -- replace "Prior Authorization" with any process (claims adjudication, invoice approval, contract review, employee onboarding, compliance audit, etc.).

---

## Table of Contents

1. [Philosophy & Architecture](#1-philosophy--architecture)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Phase 0: Market Research](#4-phase-0-market-research)
5. [Phase 1: Domain Analysis](#5-phase-1-domain-analysis)
6. [Phase 2: Scaffold the Application](#6-phase-2-scaffold-the-application)
7. [Phase 3: Design System](#7-phase-3-design-system)
8. [Phase 4: Domain Types, Seed Data & Supabase Schema](#8-phase-4-domain-types-seed-data--supabase-schema)
9. [Phase 5: API Abstraction Layer](#9-phase-5-api-abstraction-layer)
10. [Phase 6: Authentication & RBAC](#10-phase-6-authentication--rbac)
11. [Phase 7: Core Pages](#11-phase-7-core-pages)
12. [Phase 8: Kognitos Integration](#12-phase-8-kognitos-integration)
13. [Phase 9: Write Operations Catalog & SOP Generation](#13-phase-9-write-operations-catalog--sop-generation)
14. [Phase 10: Dynamic Metrics via SQL Queries](#14-phase-10-dynamic-metrics-via-sql-queries)
15. [Phase 11: Advanced Features](#15-phase-11-advanced-features)
16. [Conventions & Patterns Reference](#16-conventions--patterns-reference)
17. [Build Checklist](#17-build-checklist)
18. [User Stories](#18-user-stories)
19. [Acceptance Testing](#19-acceptance-testing)

---

## 1. Philosophy & Architecture

### Separation of Concerns

The system has three layers:

- **Presentation Layer** (this app): Next.js on Vercel. Handles UI, routing, state, and data display. Does NOT encode business rules.
- **Business Logic Layer** (Kognitos): English-as-Code SOPs that are API-callable. Each SOP handles a step of the domain workflow. Edge cases and exceptions are handled internally by the SOPs.
- **Data Layer** (Supabase / Database): PostgreSQL tables that store the domain entities. SQL queries compute all metrics and aggregates -- no custom API endpoints for computed data.

### Key Principle

The presentation layer calls Kognitos SOPs via API to execute business logic and reads data tables via SQL queries. Business rules live in the SOPs, not in TypeScript. The app is a workflow orchestrator and data viewer, not a rules engine.

**Critical — all write operations must persist to the database.** A user action that only updates React state (`setEntity(...)`) without writing to Supabase is a bug. Navigate away and all progress is lost. Every action button must trigger either a Kognitos SOP run or a direct Supabase write.

### Hybrid Write Architecture

Write operations use a **hybrid pattern** — the choice depends on whether the action involves business logic:

| Category | Route | When to use | Examples |
|----------|-------|-------------|----------|
| **SOP-routed** | `createRun(sopId, inputs)` | Action involves business logic, validation, AI, cross-system orchestration, or regulatory tracking | Auto-process entity, accept/submit outputs, audit, finalize |
| **Direct CRUD** | `updateEntity()` + `insertAuditEvent()` | Simple state transition or data mutation with no business rules | Assign user, start manual review, resolve query, create entity |

Both categories **must** create an audit event in Supabase for traceability. The difference is whether the business logic execution layer is Kognitos or a simple TypeScript function.

```
┌─────────────────────────────────────────────────────────┐
│                   Presentation Layer                     │
│            Next.js / Vercel / shadcn/ui                  │
│                                                          │
│   Worklist ─ Detail ─ Dashboard ─ Rules ─ Settings       │
└───────┬──────────────┬──────────────────┬────────────────┘
        │ createRun()  │ updateEntity()   │ SQL queries
        │ (complex)    │ (simple CRUD)    │ (reads)
        ▼              ▼                  ▼
┌────────────────┐  ┌──────────────────────────────────────┐
│ Kognitos       │  │      Database (Supabase)              │
│ English-as-Code│──│  Domain tables + audit_events         │
│ SOPs & Runs    │  │  Metrics via SQL                      │
└────────────────┘  └──────────────────────────────────────┘
```

**SOP-routed writes**: The Kognitos SOP receives inputs, executes business logic, writes to Supabase as a side effect, and returns a completed Run with outputs. The UI calls `createRun()`, waits for completion, then re-fetches the entity from Supabase to reflect the new state.

**Direct CRUD writes**: The UI calls `updateEntity()` to write to Supabase, then `insertAuditEvent()` to log the action, then re-fetches the entity. No Kognitos run is created.

### Supabase-First Data Layer

All runtime data is served from Supabase PostgreSQL — there is no mock-data fallback at runtime:
- `lib/supabase.ts` creates the Supabase client from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `lib/db.ts` is the unified data-access layer; every function calls Supabase and throws if not configured
- `lib/queries.ts` contains async analytics functions that fetch from Supabase via `lib/db.ts`
- `lib/api/*.ts` re-exports `lib/db.ts` functions; pages always import from `@/lib/api`
- Mock data files in `lib/mock-data/` are retained only for two purposes: (1) the `scripts/seed.ts` database seeder, and (2) `MOCK_USERS` for the auth-context role switcher
- Kognitos API is still mocked with typed functions that return JSON data (`lib/kognitos/client.ts`)

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 15+ (App Router) | SSR, routing, server components |
| UI Components | shadcn/ui + Radix UI | Accessible component primitives |
| Styling | Tailwind CSS v4 | Utility-first CSS |
| Tables | TanStack Table | Sorting, filtering, pagination |
| Charts | Recharts | Dashboard visualizations |
| State | Zustand | Client-side state (filters, panels) |
| Dates | date-fns | Date formatting and math |
| Icons | Lucide React | Consistent iconography |
| Database Client | @supabase/supabase-js | Supabase PostgreSQL access |
| Auth | React Context (mock role switcher) / Supabase Auth (production) | Role-based authentication |
| Database | Supabase PostgreSQL (all environments) | Domain entity storage |
| Business Logic | Kognitos REST API (mock client during dev) | SOP execution, run management |

### Dependencies (package.json)

```json
{
  "dependencies": {
    "@tanstack/react-table": "^8",
    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "cmdk": "^1",
    "date-fns": "^4",
    "lucide-react": "^0.575",
    "next": "^16",
    "radix-ui": "^1",
    "react": "^19",
    "react-dom": "^19",
    "recharts": "^3",
    "tailwind-merge": "^3",
    "zustand": "^5",
    "@supabase/supabase-js": "^2",
    "@supabase/ssr": "^0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "shadcn": "^3",
    "tailwindcss": "^4",
    "tw-animate-css": "^1",
    "typescript": "^5"
  }
}
```

---

## 3. Project Structure

```
app-name/
├── app/
│   ├── layout.tsx                          # Root layout (AuthProvider, metadata, fonts)
│   ├── globals.css                         # Tailwind imports, theme tokens, fonts
│   ├── (auth)/
│   │   └── login/page.tsx                  # Login with role selector
│   └── (dashboard)/
│       ├── layout.tsx                      # Sidebar + Topbar shell + page guard
│       ├── page.tsx                        # Worklist (default landing)
│       ├── [entity]/[id]/page.tsx          # Entity detail (tabbed)
│       ├── dashboard/page.tsx              # Analytics dashboard
│       ├── rules/page.tsx                  # SOP/Rules browser
│       ├── rules/[id]/page.tsx             # Rule detail + run history
│       ├── notifications/page.tsx          # Notification history
│       └── settings/page.tsx               # Org settings
│           ├── users/page.tsx
│           └── [domain-config]/page.tsx
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx                     # Nav sidebar (role-filtered)
│   │   └── topbar.tsx                      # Search, notifications, user menu
│   ├── ui/                                 # shadcn/ui components (badge, button, card, etc.)
│   ├── [domain]/                           # Domain-specific components
│   │   ├── status-badge.tsx                # Status → badge mapping
│   │   ├── priority-badge.tsx
│   │   ├── confidence-score.tsx
│   │   ├── criterion-card.tsx              # Checklist item display
│   │   └── timeline-event.tsx              # Audit log event
│   └── worklist/
│       ├── worklist-filters.tsx            # Filter bar
│       └── worklist-table.tsx              # TanStack Table
├── lib/
│   ├── types.ts                            # All domain types
│   ├── constants.ts                        # Role labels, status labels, etc.
│   ├── utils.ts                            # cn() and helpers
│   ├── supabase.ts                         # Supabase client (from env vars)
│   ├── db.ts                               # Data-access layer (all reads via Supabase)
│   ├── auth-context.tsx                    # React Context for auth
│   ├── role-permissions.ts                 # RBAC config + helpers
│   ├── queries.ts                          # Async analytics query functions (via lib/db)
│   ├── api/                                # Async API abstraction (re-exports lib/db)
│   │   ├── index.ts                        # Re-exports all API functions
│   │   ├── [entity].ts                     # Per-entity API module
│   │   └── ...
│   ├── kognitos/                           # Kognitos API client (mock)
│   │   ├── client.ts                       # getRun, listRuns, getRunEvents, etc.
│   │   └── index.ts                        # Re-exports
│   └── mock-data/                          # Seed data & auth mock only
│       ├── index.ts                        # Re-exports + MOCK_USERS for auth
│       ├── [entity].ts                     # Per-entity data arrays (seed source)
│       └── kognitos.ts                     # Mock runs, events, insights, metrics
├── supabase/
│   └── migrations/
│       └── [timestamp]_init_schema.sql     # PostgreSQL schema (all tables, enums, RLS)
├── scripts/
│   └── seed.ts                             # Upserts mock data into Supabase
├── public/
│   └── fonts/                              # Custom font files
└── [domain]-docs/
    ├── PRD.md                              # Product Requirements Document
    ├── PRESENTATION.md                     # Presentation layer PRD
    └── BUSINESS_LOGIC.md                   # Business logic PRD (SOP definitions)
```

---

## 4. Phase 0: Market Research

Before writing any code or making domain decisions, research the target domain to ground all design choices in real-world data. This phase produces a research document that informs every subsequent phase.

### 4.1 Industry Analysis

Investigate the target domain's landscape:

- **Market size and pain points**: What is the annual cost of the problem? What are the key inefficiencies in the current manual process? What is the rework cost per unit of work?
- **Volume and scale**: How many entities flow through this process annually? What percentage fail or require rework? What is the average processing time?
- **Trends**: Is the problem growing or shrinking? What regulatory or technological changes are affecting the space?

**Output**: A paragraph summarizing the market opportunity with specific dollar figures and percentages.

### 4.2 Competitor Landscape

Research 4-6 key players in the space:

- **For each competitor**: Name, product category, key features, differentiators, pricing model (if public)
- **Table-stakes features**: What does every competitor offer? These are minimum requirements for the app.
- **Differentiation opportunities**: What gaps exist? Where can Kognitos English-as-Code SOPs provide an advantage that competitors' hard-coded rule engines cannot?

**Output**: A competitor matrix and a list of must-have vs. differentiating features.

### 4.3 Regulatory & Compliance Context

Identify the regulations that govern the domain:

- **Data privacy**: What data protection requirements apply? (e.g., HIPAA for healthcare, SOX for finance)
- **Audit requirements**: What level of traceability is mandated? This directly informs the audit_events table design.
- **Process-specific regulations**: Are there mandated timelines, appeal levels, review processes, or reporting requirements?
- **Jurisdictional variation**: Do rules differ by state, country, or payer/counterparty?

**Output**: A list of regulatory constraints that must be reflected in the data model, status lifecycle, and audit trail.

### 4.4 Deriving Domain Requirements

Synthesize the research into concrete technical requirements:

- **Entity lifecycle statuses**: Derived from the real-world process steps (not invented)
- **Roles**: Derived from the actual job titles and responsibilities in the domain
- **Categories/taxonomies**: Derived from industry-standard classifications
- **Key metrics**: Derived from what practitioners actually measure and report on
- **SOP candidates**: Derived from decision points where AI reading, reasoning, and writing can replace manual work
- **Deadline/SLA requirements**: Derived from regulatory or contractual timelines

**Output**: A structured requirements list that feeds directly into `lib/domain.config.ts` (Phase 2) and `lib/types.ts` (Phase 4).

### 4.5 Research Document Template

```markdown
# [Domain] Market Research

## Industry Context
- Market size: $X annually
- Key pain point: [description]
- Rework cost: $X per unit
- Failure/rework rate: X%

## Competitor Landscape
| Competitor | Category | Key Features | Differentiator |
|------------|----------|-------------- |----------------|
| [Name]     | [Type]   | [Features]   | [Differentiator] |

## Regulatory Context
- [Regulation 1]: [Impact on app design]
- [Regulation 2]: [Impact on app design]

## Derived Requirements
- Statuses: [list]
- Roles: [list]
- Categories: [list]
- SOPs: [list]
- Key metrics: [list]
- Deadlines/SLAs: [list]
```

---

## 5. Phase 1: Domain Analysis

Before writing any code, create three documents:

### 5.1 Domain Process Map

Identify the core workflow of the domain. Map out:

- **Entity lifecycle**: What statuses does the primary entity go through? (e.g., `draft → submitted → under_review → approved → closed`)
- **Actors/roles**: Who interacts with the system? (e.g., Submitter, Reviewer, Manager, Admin)
- **Decision points**: Where does business logic live? These become SOPs.
- **External systems**: What integrations exist? (e.g., payer portals, EHR, HRIS)

### 5.2 Business Logic PRD (BUSINESS_LOGIC.md)

Define each SOP that will run on Kognitos:

```markdown
## SOP: [sop-name]
- **Trigger**: What starts this SOP
- **Inputs**: What data it receives
- **Logic**: What it does (in English)
- **Outputs**: What it produces (key-value pairs)
- **Edge Cases**: What exceptions it handles internally
```

Map SOPs to Kognitos concepts:
- SOPs → Kognitos automations within a workspace
- SOP runs → Kognitos Runs API (`GET /runs/{id}`)
- Line-level results → Kognitos Run Events API (`GET /runs/{id}/events`)
- Human input needed → `awaitingGuidance` state
- Metrics → Kognitos Dashboard & Analytics APIs

### 5.3 Presentation PRD (PRESENTATION.md)

Define the screens, their data sources, and their relationship to the SOPs:

- **Worklist**: Primary screen showing all entities with filters/sort/search
- **Entity Detail**: Tabbed view with all related data and action sidebar
- **Dashboard**: KPI cards + charts sourced from SQL queries and Kognitos analytics
- **Rules/SOPs**: Browser for viewing SOP definitions and their execution history
- **Notifications**: Real-time alerts for status changes and SLA breaches
- **Settings**: Organization, users, and domain configuration

---

## 6. Phase 2: Scaffold the Application

### 6.1 Create the Next.js App

```bash
npx create-next-app@latest app-name --typescript --tailwind --eslint --app --src=false
cd app-name
```

### 6.2 Install Dependencies

```bash
npm install @tanstack/react-table recharts zustand date-fns lucide-react cmdk
npx shadcn@latest init
```

### 6.3 Install shadcn Components

```bash
npx shadcn@latest add badge button card checkbox command dialog dropdown-menu \
  input label popover scroll-area select separator sheet skeleton table tabs \
  textarea tooltip avatar
```

### 6.4 Create Directory Structure

Create the folder structure from Section 3. Set up route groups `(auth)` and `(dashboard)`.

---

## 7. Phase 3: Design System

### 7.1 Custom Fonts

Place font files in `public/fonts/`. Add `@font-face` declarations in `globals.css`.

### 7.2 Theme Tokens

In `globals.css`, define the theme using Tailwind v4's `@theme inline`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@theme inline {
  --font-sans: 'Your Font', sans-serif;
  --font-mono: 'Your Mono Font', monospace;
  --radius-sm: var(--radius);
  --radius-md: calc(var(--radius) + 2px);
  --radius-lg: calc(var(--radius) + 4px);
  /* Semantic colors using OKLCH */
  --color-brand: oklch(...);
  --color-success: oklch(...);
  --color-warning: oklch(...);
  --color-destructive: oklch(...);
}

:root {
  --radius: 0.375rem;       /* tighter border radii */
  --background: oklch(...);
  --foreground: oklch(...);
  --primary: oklch(...);
  /* ... all shadcn color variables ... */
}
```

### 7.3 Color Palette

Use OKLCH color space for perceptual uniformity. Define:
- Brand color (primary actions, active states)
- Success, Warning, Destructive (status indicators)
- Sidebar colors (background, accent, muted)
- Chart palette (8-10 distinct colors for visualizations)

---

## 8. Phase 4: Domain Types, Seed Data & Supabase Schema

### 8.1 Define Types (`lib/types.ts`)

Start with the core domain entity and work outward:

```typescript
// 1. Status enum (discriminated union)
export type EntityStatus = "draft" | "submitted" | "under_review" | "approved" | "denied" | "closed";

// 2. Role enum
export type UserRole = "submitter" | "reviewer" | "manager" | "admin";

// 3. Priority, category, and other enums
export type Priority = "urgent" | "standard";

// 4. Core domain entity (the "case" equivalent)
export interface DomainEntity {
  id: string;
  org_id: string;
  // ... domain-specific fields
  status: EntityStatus;
  priority: Priority;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  kognitos_run_id: string;  // links to Kognitos run
}

// 5. Related entities
export interface ChecklistItem { ... }
export interface Submission { ... }
export interface AuditEvent { ... }

// 6. Kognitos types (standard across all domains)
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
  invocationDetails: { invocationSource: string };
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

export interface KognitosInsights { ... }
export interface KognitosMetricResult { ... }

// 7. User and auth
export interface User {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
}
```

### 8.2 Create Supabase Schema (`supabase/migrations/`)

Map every TypeScript type to a PostgreSQL table. Use `supabase db push` to apply:

```sql
-- Use PostgreSQL ENUMs for status/priority string unions
CREATE TYPE entity_status AS ENUM ('draft','submitted','under_review','approved','denied','closed');
CREATE TYPE priority AS ENUM ('urgent','standard');

-- Core entity table
CREATE TABLE entities (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES organizations(id),
  status                entity_status NOT NULL DEFAULT 'draft',
  priority              priority NOT NULL DEFAULT 'standard',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  assigned_to           text REFERENCES users(id),
  kognitos_run_id       text,
  -- domain-specific columns...
);

-- Enable RLS on all tables
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON entities FOR SELECT USING (true);
```

**Critical — RLS write policies:** The schema above enables RLS and creates `SELECT` policies, but the app also needs `INSERT` and `UPDATE` policies for every table it writes to. Without these, the anon key (used by the browser) is silently blocked from all writes — no error is thrown, the operation just returns empty results.

Create a **separate migration file** (e.g., `00000000000001_write_policies.sql`) with write policies:

```sql
-- Allow anon writes for demo app (mock auth, no Supabase Auth)
CREATE POLICY "Allow public insert" ON entities FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON entities FOR UPDATE USING (true);

CREATE POLICY "Allow public insert" ON audit_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON audit_events FOR UPDATE USING (true);

-- Repeat for every table the UI writes to (entities, audit_events, comments, notifications, etc.)
```

**Why this is easy to miss:** The seed script uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely. So seeding succeeds, reads work (SELECT policy exists), and the app looks correct — until you click an action button and the write silently fails. Always test writes with the anon key, not the service role key.

**Migration file ordering:** Supabase applies migration files in filename sort order. Use zero-padded timestamp prefixes (e.g., `00000000000000_schema.sql`, `00000000000001_write_policies.sql`) to ensure the schema is created before policies reference its tables.

**Schema guidelines:**
- Use `text` primary keys matching the TypeScript `id` field
- Use `jsonb` for flexible nested objects (e.g., `eligibility_status`, `criteria_summary`)
- Add foreign key constraints for all relationships
- Create indexes on frequently filtered columns (`status`, `payer_id`, `assigned_to`)
- Enable Row Level Security on all tables
- **Create INSERT and UPDATE policies for every table the app writes to** — not just SELECT

### 8.3 Create Seed Data (`lib/mock-data/` + `scripts/seed.ts`)

Mock data files in `lib/mock-data/` serve as the **seed source**. For each entity type, create a `.ts` file exporting a typed array:

```typescript
// lib/mock-data/entities.ts
import type { DomainEntity } from "@/lib/types";

export const entities: DomainEntity[] = [
  { id: "entity-1", status: "approved", ... },
  { id: "entity-2", status: "submitted", ... },
  // 20-60 records covering all statuses and edge cases
];
```

**Guidelines for seed data:**
- Cover every status in the lifecycle
- Include at least 3-5 records per status
- Ensure foreign keys are consistent (entity → user, entity → related records)
- Every entity should have a `kognitos_run_id` linking to a mock run
- Mock runs should have outputs that are consistent with the entity's database state
- Include realistic dates, names, and values

**Critical — ID consistency between `MOCK_USERS` and seed data:**

The `MOCK_USERS` map in `lib/types.ts` (used by the auth context role switcher) and the `users` array in `lib/mock-data/` (used by `scripts/seed.ts`) **must use the same IDs, org_ids, and field values**. A mismatch causes silent failures across the entire app:
- Notifications filtered by `user_id` return empty results
- Comments and timeline events show "Unknown" instead of the author's name
- Assigned-to lookups fail, breaking the entity detail page
- New entity creation uses the wrong `org_id`, orphaning records

**Rule:** Define user IDs in one place (seed data) and derive `MOCK_USERS` from the same source. After creating seed data, verify that every `user_id`, `org_id`, and `assigned_to` foreign key in every seed file matches an actual user/org record.

### 8.4 Database Seeder (`scripts/seed.ts`)

A TypeScript script that upserts all mock data into Supabase using the service role key:

```typescript
import { createClient } from "@supabase/supabase-js";
// import all mock data arrays...

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // bypasses RLS
  { auth: { persistSession: false } }
);

async function upsert(table: string, rows: Record<string, unknown>[]) {
  const { error } = await sb.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw error;
  console.log(`  ✓ ${table}: ${rows.length} rows`);
}

async function main() {
  // Upsert in dependency order (parents before children)
  await upsert("organizations", [...]);
  await upsert("users", [...]);
  await upsert("entities", [...]);
  // ... all other tables
}

main().catch(console.error);
```

Run with: `SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed.ts`

### 8.5 Supabase Client (`lib/supabase.ts`)

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
```

### 8.6 Data Access Layer (`lib/db.ts`)

All runtime data reads go through this module. Every function calls Supabase directly:

```typescript
import { supabase } from "./supabase";
import type { DomainEntity, User } from "./types";

function sb() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function getAllEntities(): Promise<DomainEntity[]> {
  const { data, error } = await sb().from("entities").select("*");
  if (error) throw error;
  return data as DomainEntity[];
}

export async function getEntityById(id: string): Promise<DomainEntity | undefined> {
  const { data, error } = await sb().from("entities").select("*").eq("id", id).single();
  if (error) return undefined;
  return data as DomainEntity;
}

// ... similar read functions for all entity types and relationships
```

### 8.7 Write Functions in `lib/db.ts`

In addition to reads, `lib/db.ts` must expose write functions for every entity that the UI mutates. **Every action button in the app must call one of these** — never rely on React state alone for persistence.

```typescript
export async function updateEntity(
  id: string,
  updates: Partial<Omit<DomainEntity, "id">>
): Promise<DomainEntity> {
  const { data, error } = await sb()
    .from("entities")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as DomainEntity;
}

export async function insertEntity(entity: DomainEntity): Promise<DomainEntity> {
  const { data, error } = await sb()
    .from("entities")
    .insert(entity)
    .select()
    .single();
  if (error) throw error;
  return data as DomainEntity;
}

export async function insertAuditEvent(event: {
  id: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  details: Record<string, unknown>;
}): Promise<AuditEvent> {
  const { data, error } = await sb()
    .from("audit_events")
    .insert({ ...event, created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data as AuditEvent;
}
```

**Critical rule**: If a page calls `setEntity(...)` to update local state after an action, it **must also** call `updateEntity()` (or `createRun()`) **before** or **alongside** the state update. State-only updates are ephemeral and lose all changes on navigation.

**Important:** `lib/db.ts` does NOT import from `lib/mock-data/`. There is no fallback — if Supabase is not configured, functions throw. Mock data files are only used by the seed script and the auth context role switcher.

---

## 9. Phase 5: API Abstraction Layer

### 9.1 API Module (`lib/api/`)

Re-export `lib/db.ts` async functions. This keeps a clean import boundary for pages:

```typescript
// lib/api/entities.ts
import type { DomainEntity } from "@/lib/types";
import { getAllEntities, getEntityById as _getEntityById } from "@/lib/db";

export async function listEntities(): Promise<DomainEntity[]> {
  return getAllEntities();
}

export async function getEntityById(id: string): Promise<DomainEntity | undefined> {
  return _getEntityById(id);
}
```

### 9.2 API Index (`lib/api/index.ts`)

Re-export everything so pages import from a single path:

```typescript
// Reads
export { listEntities, getEntityById, ... } from "./entities";
export { listUsers, getUserById, getUserForRole } from "./users";
export { queryInsights, queryMetrics, getRun, listRuns, getRunEvents } from "@/lib/kognitos";

// Writes (direct CRUD)
export { updateEntity, insertEntity, insertAuditEvent } from "./entities";

// Writes (SOP-routed via Kognitos)
export { createRun } from "@/lib/kognitos";
```

**Rules:**
- Pages always import from `@/lib/api`, never from `@/lib/db` or `@/lib/mock-data` directly
- All functions are async (return Promises) since they fetch from Supabase
- No synchronous data accessors (e.g., no `getUserByIdSync`) — all lookups are async
- The only exception: `getUserForRole()` uses the static `MOCK_USERS` map from `lib/mock-data` for the auth context role switcher
- **Write functions must be exported alongside reads** — if a page can trigger an action, the corresponding write function must be available via `@/lib/api`

---

## 10. Phase 6: Authentication & RBAC

### 10.1 Auth Context (`lib/auth-context.tsx`)

```typescript
"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User, UserRole } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  login: (role: UserRole) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Restore from localStorage on mount
    const stored = localStorage.getItem("app_user");
    if (stored) setUser(JSON.parse(stored));
    setHydrated(true);
  }, []);

  const login = useCallback((role: UserRole) => {
    const mockUser = getUserForRole(role); // from API
    setUser(mockUser);
    localStorage.setItem("app_user", JSON.stringify(mockUser));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("app_user");
  }, []);

  if (!hydrated) return null;

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

### 10.2 Role Permissions (`lib/role-permissions.ts`)

Define a centralized config mapping each role to:
- **allowedPaths**: Which sidebar nav items to show (and which pages to allow)
- **defaultPath**: Where to redirect after login
- **actions**: Which entity actions are enabled (e.g., submit, assign, escalate, cancel)

```typescript
import type { UserRole } from "@/lib/types";

export type EntityAction = "submit" | "assign" | "escalate" | "cancel" | "create" | ...;

export const ROLE_PERMISSIONS: Record<UserRole, {
  allowedPaths: string[];
  defaultPath: string;
  actions: EntityAction[] | ["*"];
}> = {
  submitter: {
    allowedPaths: ["/", "/entities", "/notifications"],
    defaultPath: "/",
    actions: ["submit", "assign", "create"],
  },
  reviewer: {
    allowedPaths: ["/", "/entities", "/rules", "/notifications"],
    defaultPath: "/",
    actions: ["assign", "escalate"],
  },
  manager: {
    allowedPaths: ["/", "/entities", "/dashboard", "/rules", "/notifications", "/settings"],
    defaultPath: "/dashboard",
    actions: ["assign"],
  },
  admin: {
    allowedPaths: ["*"],
    defaultPath: "/dashboard",
    actions: ["*"],
  },
};

export function canAccessPath(role: UserRole, path: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (perms.allowedPaths.includes("*")) return true;
  const normalised = path.replace(/\/$/, "") || "/";
  return perms.allowedPaths.some((a) =>
    a === "/" ? normalised === "/" : normalised === a || normalised.startsWith(a + "/")
  );
}

export function canPerformAction(role: UserRole, action: EntityAction): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return (perms.actions as string[]).includes("*") || (perms.actions as EntityAction[]).includes(action);
}

export function getDefaultPath(role: UserRole): string {
  return ROLE_PERMISSIONS[role].defaultPath;
}
```

### 10.3 Where RBAC Is Enforced

| Location | What it does |
|----------|-------------|
| `app/(auth)/login/page.tsx` | Calls `getDefaultPath(role)` after login to redirect to the right page |
| `app/(dashboard)/layout.tsx` | Checks `canAccessPath(user.role, pathname)` on every navigation; redirects unauthorized roles |
| `components/layout/sidebar.tsx` | Filters `NAV_ITEMS` array with `canAccessPath(user.role, item.href)` |
| Entity detail action sidebar | Wraps each button with `canPerformAction(role, "action")` |
| Worklist page | Conditionally hides "New Entity" and "Export" buttons based on role |
| Dashboard page | Reorders/hides sections based on role (e.g., financial-first for billing) |

---

## 11. Phase 7: Core Pages

### 11.1 Login Page

- Role selector dropdown (no real credentials for mock)
- On submit: `login(role)` then `router.push(getDefaultPath(role))`
- Styled as a centered card with the app logo

### 11.2 Dashboard Layout (`app/(dashboard)/layout.tsx`)

```typescript
"use client";
export default function DashboardLayout({ children }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!user) { router.replace("/login"); return; }
    if (!canAccessPath(user.role, pathname)) { router.replace(getDefaultPath(user.role)); }
  }, [user, router, pathname]);

  if (!user || !canAccessPath(user.role, pathname)) return null;

  return (
    <div className="min-h-svh bg-muted/30">
      <Sidebar />
      <div className="lg:pl-64">
        <Topbar />
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
```

### 11.3 Worklist (Primary Screen)

The worklist is the default page for most roles. It contains:

1. **Header**: Title, entity count, action buttons (New Entity, Export CSV)
2. **Filter bar**: Search input, status multi-select, category dropdown, priority toggle, clear button
3. **Table**: TanStack Table with sortable columns, row selection, pagination, row-click navigation
4. **Role awareness**: Physicians/read-only roles see filtered data and no action buttons

**Filter pattern**: Controlled state with `WorklistFilters` interface:

```typescript
interface WorklistFilters {
  search: string;
  statuses: EntityStatus[];
  categoryId: string | null;
  priority: Priority | null;
}
```

### 11.4 Entity Detail (Tabbed)

The most complex page. Structure:

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Worklist                                     │
├─────────────────────────────────────────────┬───────────┤
│  Header Card (entity info, status, badges)  │ Actions   │
├─────────────────────────────────────────────┤ Sidebar   │
│  Tabs:                                      │           │
│  ┌─────────────────────────────────────────┐│ Submit    │
│  │ Overview | Documents | Submissions |    ││ Assign    │
│  │ Denials | Queries | Timeline | Letters  ││ Escalate  │
│  │ | SOP Run                               ││ Cancel    │
│  └─────────────────────────────────────────┘│           │
│  Tab Content                                │ Quick Info│
└─────────────────────────────────────────────┴───────────┘
```

**Tab patterns:**
- **Overview**: Checklist cards (met/unmet), gaps, next action recommendation, predictive scores, alternative suggestions
- **Documents**: File list with type badge, upload button
- **Submissions**: Timeline of attempts with channel icon, status
- **Issues & Appeals**: Issue cards with classification, appeal editor
- **Queries**: Question cards with response field
- **Timeline**: Chronological audit log using `TimelineEvent` component
- **Letters**: Generated documents with regenerate/download
- **SOP Run**: Kognitos run visibility (see Phase 7)

**Status-aware action panel**: Actions must be gated by **both** the entity's current status **and** the user's role. A static list of buttons gated only by role creates dead ends where entities in certain statuses have no available actions (e.g., a newly created entity stuck at `draft` with no "Submit" button).

Define a `STATUS_ACTIONS` constant mapping each status to its available actions:

```typescript
interface StatusAction {
  key: string;           // action identifier (e.g., "submit", "run_auto_process")
  label: string;         // button label
  icon: LucideIcon;      // button icon
  variant: "default" | "outline" | "destructive";
  requiredActions: EntityAction[];  // RBAC actions the user's role must have
}

const STATUS_ACTIONS: Partial<Record<EntityStatus, StatusAction[]>> = {
  draft: [
    { key: "submit", label: "Submit", icon: Send, variant: "default", requiredActions: ["submit"] },
    { key: "run_auto_process", label: "Run Auto-Process", icon: Zap, variant: "outline", requiredActions: ["submit"] },
  ],
  submitted: [
    { key: "start_review", label: "Start Review", icon: Eye, variant: "default", requiredActions: ["assign"] },
  ],
  under_review: [
    { key: "approve", label: "Approve", icon: Check, variant: "default", requiredActions: ["approve"] },
    { key: "deny", label: "Deny", icon: X, variant: "destructive", requiredActions: ["deny"] },
    { key: "send_query", label: "Send Query", icon: MessageSquare, variant: "outline", requiredActions: ["query"] },
  ],
  // ... map every non-terminal status
};
```

At render time, filter `STATUS_ACTIONS[entity.status]` by the user's role using `canPerformAction`. For terminal statuses (e.g., `closed`, `finalized`), display a "No actions available" message. Show loading states during async action processing.

**Key rules:**
- Every non-terminal status must have at least one action defined
- The initial status (the one entities are created with) must have actions that advance the workflow
- Include Kognitos SOP trigger actions (e.g., "Run Auto-Process") where the business logic layer should be invoked
- **Every action handler must persist to Supabase** — either via `createRun()` for SOP-routed actions or via `updateEntity()` + `insertAuditEvent()` for direct CRUD. After persistence, call a `refreshEntity()` helper that re-fetches the entity and audit events from Supabase to update local state. Never rely on `setEntity(...)` alone — state-only updates are lost on navigation.

**URL deep-linking**: Read `useSearchParams().get("tab")` to set the default tab value, enabling `?tab=sop-run` links.

### 11.5 Dashboard

1. **KPI Cards** in a responsive grid (`grid-cols-2 md:grid-cols-3 xl:grid-cols-6`):
   - All values computed from SQL query functions, never hard-coded
   - Each card: label, value, icon, optional trend
   - Role-aware ordering (financial-first for billing roles)

2. **Charts** (2x2 grid using Recharts):
   - Line chart: Volume over time
   - Area chart: Approval vs denial trend (stacked)
   - Pie chart: Entities by status (with drill-down on click)
   - Bar chart: Issue breakdown (with drill-down on click)

3. **Tables**:
   - Performance by category (e.g., payer, department, vendor)
   - Eligibility/thresholds (e.g., gold card, fast-track)
   - Team productivity

4. **Interactive drill-down**: Clicking any chart element or table row opens a `Sheet` sliding in from the right showing a filtered table of entities. Use `useState<{ title: string; entities: Entity[] } | null>(null)` for drill-down state.

5. **Role awareness**:
   - Manager roles see Team Productivity first
   - Financial roles see revenue KPIs first
   - Some sections hidden for non-applicable roles

### 11.6 Rules/SOPs Browser

- List page: Cards per rule grouped by category with computed metrics (approval rate, hit rate, gap rate)
- Detail page: Rule content with keyword highlighting, version history sidebar, metrics sidebar
- **Run History** section below the rule content showing all Kognitos runs that used that rule, as an expandable table with inline input/output details

**Rule criteria must be written in plain English with markdown formatting.** Kognitos is an "English as Code" platform — the rules displayed in the app should read like step-by-step instructions a human expert would follow, not like programming conditionals. This applies to both the seed data (`rules` table `criteria` field) and any future rule authoring UI.

**Data format**: Store rule criteria as markdown text using `##` for the rule title, `###` for step headings, `-` for bullet lists, `  -` for nested sub-bullets, and numbered lists (`1.`, `2.`) where order matters:

```markdown
## Rule Title

### Step 1: Verify Requirement
- Check condition A
- Check condition B

### Step 2: Eligibility Check
Approval criteria (must meet at least ONE):
- Criterion with detail
- Another criterion
  - Sub-detail or nested requirement
  - Another sub-detail

### Step 3: Resolve
If criteria met: accept.
If criteria not met: flag for review.

### Exception
- Edge case that overrides the normal flow
```

**Rendering**: Do NOT render criteria as a raw `<pre>` block or with monospace font. Instead, build a `renderCriteria()` function that parses the markdown line-by-line into styled React elements:

```typescript
function renderCriteria(content: string) {
  const lines = content.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("##")) {
      // ## → <h2>, ### → <h3>
    }
    if (line.startsWith("  - ")) {
      // nested bullet → indented dot + text
    }
    if (line.startsWith("- ")) {
      // top-level bullet → dot + text
    }
    if (line.match(/^\d+\.\s/)) {
      // numbered list → padded paragraph
    }
    // keyword highlighting: bold + blue for action verbs
    // empty lines → spacer div
    // default → <p> with text-sm
  });
}
```

Highlight domain-relevant action keywords (e.g., "Check", "Verify", "Confirm", "Review", "Flag", "Must", "Required") in **bold blue** to make the steps scannable.

**Avoid:**
- Pseudocode syntax (`IF x THEN y`, `AND`, `OR`, function calls like `flag_for_review()`)
- Long run-on sentences — break into short, scannable lines
- Monospace / code font for criteria display
- Raw `<pre>` or `whitespace-pre-wrap` rendering without parsing headings and bullets

### 11.7 Notifications

- Bell icon in topbar with dynamic unread count (`queryUnreadNotificationCount(user.id)`)
- Full page: Tabs for All/Unread, alert cards for SLA breaches, notification list with mark-as-read

### 11.8 Settings

- Organization info form (name, identifiers, address)
- Users table with role badges
- Domain config table (e.g., payers, departments, vendors)

---

## 12. Phase 8: Kognitos Integration

### 12.1 Mock Kognitos Client (`lib/kognitos/client.ts`)

Mirror the Kognitos REST API with mock functions:

```typescript
// Each function documents the HTTP endpoint it simulates
/** Simulates GET /api/v1/.../runs/{run_id} */
export async function getRun(runId: string): Promise<KognitosRun | null> { ... }

/** Simulates GET /api/v1/.../runs */
export async function listRuns(options?: { pageSize?: number; filter?: string }): Promise<{ runs: KognitosRun[]; nextPageToken: string | null }> { ... }

/** Simulates GET /api/v1/.../runs/{run_id}/events */
export async function getRunEvents(runId: string): Promise<{ runEvents: KognitosRunEvent[]; nextPageToken: string | null }> { ... }

/** Simulates GET /api/v1/.../dashboards:queryInsights */
export async function queryInsights(): Promise<KognitosInsights> { ... }

/** Simulates GET /api/v1/.../metrics:query */
export async function queryMetrics(options?: { metrics?: string[]; groupBy?: string[] }): Promise<{ results: KognitosMetricResult[] }> { ... }

/** Simulates GET /api/v1/.../workspaces:automationRunAggregates */
export async function getAutomationRunAggregates(): Promise<...> { ... }
```

### 12.2 `createRun()` — SOP-Routed Writes

For actions that involve business logic, the UI calls `createRun()` to execute a Kognitos SOP:

```typescript
/** Simulates POST /api/v1/.../runs (execute SOP) */
export async function createRun(
  sopId: string,
  userInputs: Record<string, string>
): Promise<KognitosRun> { ... }
```

The mock implementation dispatches to an executor function per SOP (e.g., `executeAutoCode`, `executeAudit`) that:
1. Performs the business logic (AI suggestions, validation, etc.)
2. Writes the result to Supabase via `updateEntity()` and `insertAuditEvent()`
3. Returns a mock `KognitosRun` with `state: "completed"` and relevant `outputs`

**Action → SOP mapping**: Define a `SOP_ACTION_MAP` constant that maps UI action keys to Kognitos SOP IDs. The entity detail page's `handleAction` function uses this map to decide whether an action is SOP-routed or direct CRUD:

```typescript
const SOP_ACTIONS = ["run_auto_process", "accept_outputs", "audit", "finalize"] as const;
const SOP_ACTION_MAP: Record<string, string> = {
  run_auto_process: "sop-auto-process",
  accept_outputs: "sop-accept",
  audit: "sop-audit",
  finalize: "sop-finalize",
};

async function handleAction(action: string) {
  if (action in SOP_ACTION_MAP) {
    await createRun(SOP_ACTION_MAP[action], { entity_id: entity.id, ... });
  } else {
    await updateEntity(entity.id, { status: newStatus });
    await insertAuditEvent({ ... });
  }
  await refreshEntity();
}
```

### 12.3 Mock Run Data Consistency

Every mock run's `state.completed.outputs` should match the corresponding entity's data in the database tables. This demonstrates that the SOP produced the outputs that were then stored in the database. For example:

```typescript
// Run outputs
outputs: {
  status: "approved",
  rule_id: "rule-1",
  confidence_score: "82",
  auth_number: "AUTH-2026-001",
}

// Corresponding entity in the database
{ id: "entity-1", status: "approved", confidence_score: 82, auth_number: "AUTH-2026-001", kognitos_run_id: "run-1" }
```

### 12.4 SOP Run Tab on Entity Detail Page

Add a tab that shows the Kognitos run for this entity:

1. **Run Summary Card**: Status badge, duration, stage version, run ID
2. **Inputs Card**: Key-value display of `run.userInputs`
3. **Outputs Card**: Key-value display grouped by SOP phase (e.g., Eligibility, Criteria, Submission, Decision) with boolean values rendered as Yes/No badges
4. **Execution Trace**: Collapsible chronological timeline of `KognitosRunEvent[]`:
   - `runUpdate` events as milestone markers (larger icons, bold text)
   - `executionJournal` events as step items with decision/action icons
   - SOP badges colored by phase name
   - Expandable JSON details per event

### 12.5 Run History on Rule Detail Page

Show all runs that used a specific rule:
- Table with: Run ID, Entity Name, Key Code, Status, Confidence, Duration, Date
- Rows are expandable to show inline inputs/outputs (two-column layout)
- Link to the entity's SOP Run tab via `?tab=sop-run`

---

## 13. Phase 9: Write Operations Catalog & SOP Generation

This phase produces a complete inventory of every write operation in the app — both direct CRUD and SOP-routed — before any page-level integration. This serves as the contract between the data layer, the Kognitos client, and the UI action handlers.

### 13.1 Why a Dedicated Phase

Write operations are the most error-prone part of the app. Defining them in isolation — before wiring them into pages — ensures:

- Every action has a corresponding persistence function
- Every action creates an audit event
- SOP-routed vs. direct CRUD classification is explicit
- The `SOP_ACTION_MAP` and `STATUS_ACTIONS` are consistent
- Rule/SOP definitions in seed data align with the SOPs the client executes

### 13.2 Direct CRUD Write Functions

List every write function that `lib/db.ts` must expose. Each function writes to Supabase and returns the updated record:

```typescript
// Entity writes
updateEntity(id, updates)    // Update any entity fields + updated_at
insertEntity(entity)         // Create a new entity

// Audit trail (mandatory for every action)
insertAuditEvent(event)      // Log action with entity_id, action, actor_id, details

// Related entity writes
insertComment(comment)       // Add a comment to an entity
markNotificationRead(id)     // Mark a notification as read
```

**Completeness check**: For every action button defined in `STATUS_ACTIONS`, there must be either a direct CRUD function or a `createRun()` SOP invocation. If an action cannot be mapped to either, it is missing implementation.

### 13.3 Direct CRUD Action Handlers

For each simple state transition (no business logic), document the exact writes:

```markdown
| Action          | Entity Update                                | Audit Event Action   | Additional Writes |
|-----------------|----------------------------------------------|----------------------|-------------------|
| assign          | { assigned_to: userId }                      | "assigned"           | —                 |
| start_review    | { status: "under_review" }                   | "review_started"     | —                 |
| write_off       | { status: "written_off", closed_at: now }    | "written_off"        | —                 |
| mark_won        | { status: "resolved_won", decided_at: now }  | "resolved_won"       | —                 |
| mark_lost       | { status: "resolved_lost", decided_at: now } | "resolved_lost"      | —                 |
| close           | { status: "closed", closed_at: now }         | "closed"             | —                 |
| create          | (full entity insert)                         | "entity_created"     | —                 |
```

**Rule**: Every row in this table must use `user?.id` from the auth context as `actor_id` — never a hard-coded value.

### 13.4 SOP Definitions

For each SOP that will run on Kognitos, create a full specification:

```markdown
## SOP: [sop-id]
- **Trigger**: Which action button and from which status
- **Inputs**: Key-value pairs passed to `createRun(sopId, inputs)`
- **Logic**: Step-by-step description in English of what the SOP does
- **Outputs**: Key-value pairs in `run.state.completed.outputs`
- **Side Effects**: Exactly which Supabase writes the SOP executor performs
  - `updateEntity(id, { field: value, ... })`
  - `insertAuditEvent({ action: "...", ... })`
- **Edge Cases**: What happens on failure, timeout, or missing data
```

### 13.5 SOP Action Map

Define the mapping from UI action keys to Kognitos SOP IDs:

```typescript
const SOP_ACTION_MAP: Record<string, string> = {
  action_key_1: "sop-id-1",
  action_key_2: "sop-id-2",
  action_key_3: "sop-id-3",
};
```

The entity detail page's `handleAction` function uses this map:

```typescript
async function handleAction(action: string) {
  if (action in SOP_ACTION_MAP) {
    await createRun(SOP_ACTION_MAP[action], { entity_id: entity.id, ... });
  } else {
    await updateEntity(entity.id, { status: newStatus, ... });
    await insertAuditEvent({ ... });
  }
  await refreshEntity();
}
```

### 13.6 Rule / SOP Seed Data Generation

Generate one rule per major category in the domain. Each rule's `criteria` field must be written in **plain English with markdown formatting** (see Conventions section for formatting rules).

For each rule, also generate:
- A corresponding mock run in `lib/kognitos/client.ts` whose outputs are consistent with an entity that was processed by this rule
- Mock run events showing the step-by-step execution trace

**Consistency check**: For every entity in the seed data with a `kognitos_run_id`, the corresponding mock run must exist and its outputs must match the entity's current state.

### 13.7 STATUS_ACTIONS Completeness Verification

After defining all write operations and SOPs, verify the `STATUS_ACTIONS` constant:

- Every non-terminal status has at least one action
- The initial status has actions that advance the workflow (no dead ends)
- Every action key maps to either a direct CRUD handler or an entry in `SOP_ACTION_MAP`
- Every action's `requiredActions` array references actions defined in `DOMAIN.roles`
- Terminal statuses either have a "Close" action or display "No further actions"

```
Status              → Actions                        → Write Type
────────────────────────────────────────────────────────────────────
initial_status      → [Action1 (SOP), Action2]       → createRun / CRUD
intermediate_status → [Action3, Action4 (SOP)]       → CRUD / createRun
...
pre_terminal_status → [Resolve]                      → CRUD
terminal_status     → [Close] or "No actions"        → CRUD / —
```

---

## 14. Phase 10: Dynamic Metrics via SQL Queries

### 14.1 Query Module (`lib/queries.ts`)

All query functions are **async** — they fetch data from Supabase via `lib/db.ts`, then compute metrics in JavaScript:

```typescript
/**
 * Async query functions — all data fetched from Supabase via lib/db.
 */
import { getAllCases, getAllDenials, getAllNotifications } from "@/lib/db";

export async function queryAvgTimeToDecision(): Promise<number> {
  const cases = await getAllCases();
  const withDates = cases.filter((c) => c.decided_at && c.submitted_at);
  if (withDates.length === 0) return 0;
  const totalDays = withDates.reduce((sum, c) => {
    return sum + (new Date(c.decided_at!).getTime() - new Date(c.submitted_at!).getTime()) / 86_400_000;
  }, 0);
  return totalDays / withDates.length;
}

export async function queryFirstPassApprovalRate(): Promise<number> { ... }

export async function queryIssueBreakdown(): Promise<{ reason: string; value: number }[]> { ... }

export async function queryUnreadNotificationCount(userId: string): Promise<number> {
  const notifs = await getAllNotifications();
  return notifs.filter((n) => n.user_id === userId && !n.is_read).length;
}
```

**Key pattern:** Functions that need multiple tables use `Promise.all` to fetch in parallel:
```typescript
export async function queryDenialsByPayerService(): Promise<DenialByPayerService[]> {
  const [cases, denials] = await Promise.all([getAllCases(), getAllDenials()]);
  // ... compute metrics from both arrays
}
```

### 14.2 Zero Hard-Coded Metrics Rule

**Every number displayed in the UI must come from a query function or the Kognitos API.** No hard-coded statistics, percentages, or counts anywhere in page components. If a metric appears on screen, there must be a function computing it from data.

### 14.3 Kognitos Analytics Consistency

Update mock Kognitos insights and metrics to match the actual mock data:
- `totalRunsCount` = number of mock runs
- `totalMoneySavedUsd` = sum of revenue from approved entities
- Completion rates = computed from run states
- Time-series = computed by bucketing runs by `createTime`

---

## 15. Phase 11: Advanced Features

### 15.1 Interactive Dashboard Drill-Down

When the user clicks a chart segment, bar, table row, or data point, a `Sheet` component slides in from the right showing the matching entities:

```typescript
const [drillDown, setDrillDown] = useState<{ title: string; entities: Entity[] } | null>(null);

// In a PieChart onClick:
onClick={(data) => {
  setDrillDown({
    title: `Entities — ${data.name} (${data.value})`,
    entities: allEntities.filter((e) => e.status === data.status),
  });
}}

// Sheet component:
<Sheet open={drillDown !== null} onOpenChange={(open) => { if (!open) setDrillDown(null); }}>
  <SheetContent side="right" className="w-full sm:max-w-2xl lg:max-w-4xl">
    <SheetHeader><SheetTitle>{drillDown?.title}</SheetTitle></SheetHeader>
    {drillDown && <DrillDownTable entities={drillDown.entities} />}
  </SheetContent>
</Sheet>
```

### 15.2 Expandable Table Rows

For detailed data like run history, use expandable rows with `React.Fragment`:

```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);

{items.map((item) => (
  <React.Fragment key={item.id}>
    <tr onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} className="cursor-pointer">
      <td><ChevronDown/ChevronUp icon /></td>
      {/* ... columns ... */}
    </tr>
    {expandedId === item.id && (
      <tr><td colSpan={N} className="bg-muted/30 p-4"><DetailPanel item={item} /></td></tr>
    )}
  </React.Fragment>
))}
```

### 15.3 Global Search

Global search requires **two-sided wiring** — the topbar sends the query via URL, and the worklist page reads and applies it. Missing either side makes search appear broken.

**Topbar side** — navigate to the worklist with a URL query param:

```typescript
function handleSearchKeyDown(e: React.KeyboardEvent) {
  if (e.key === "Enter") {
    router.push(`/?search=${encodeURIComponent(searchValue)}`);
  }
}
```

**Worklist side** — read `useSearchParams` and sync to local filter state:

```typescript
import { useSearchParams } from "next/navigation";

const searchParams = useSearchParams();

useEffect(() => {
  const urlSearch = searchParams.get("search");
  if (urlSearch) {
    setFilters((prev) => ({ ...prev, search: urlSearch }));
  }
}, [searchParams]);
```

**Important:** Both sides must be implemented. The topbar navigation alone is not enough — the worklist page must explicitly read the URL parameter and update its local `filters` state, or the search term will be silently ignored.

### 15.4 CSV Export

```typescript
function exportToCSV(entities: Entity[]) {
  const headers = ["ID", "Name", "Status", ...];
  const rows = entities.map((e) => [e.id, e.name, e.status, ...]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "export.csv"; a.click();
  URL.revokeObjectURL(url);
}
```

### 15.5 Predictive Scoring

Query historical approval rates for the same combination of attributes:

```typescript
export async function queryPredictiveScore(codes: string[], categoryId: string): Promise<{
  predicted_approval_pct: number;
  risk_label: "LOW_RISK" | "MEDIUM_RISK" | "HIGH_RISK";
  historical_decided: number;
}> { ... }
```

### 15.6 Threshold / Gold Card Engine

Track approval rates by actor + code + category and flag high-performers:

```typescript
export async function queryGoldCardEligibility(): Promise<{
  actor_id: string; actor_name: string; code: string; category_id: string;
  total_decided: number; approval_rate: number; eligible: boolean;
}[]> { ... }
```

### 15.7 Entity Creation Dialog

A `Dialog` with a form that creates a new entity in the local state:
- Key fields: name, category, codes, priority, estimated value
- On submit: adds to `allEntities` state, closes dialog, shows success alert

### 15.8 Episode/Bundle Grouping

Add an `episode_id` field to the entity type to group related entities:

```typescript
export async function queryEpisodes(): Promise<{
  episode_id: string; entity_name: string;
  entities: Entity[]; total_value: number;
}[]> { ... }
```

Display as cards in the worklist page above the filter bar.

---

## 16. Conventions & Patterns Reference

### Naming

| Item | Convention | Example |
|------|-----------|---------|
| Types | PascalCase | `PACase`, `DomainEntity` |
| Status enums | snake_case string unions | `"ready_to_submit"` |
| Mock data files | kebab-case | `criteria-matches.ts` |
| API functions | camelCase, verb-first | `getCaseById`, `listCases` |
| Query functions | `query` prefix | `queryDenialRate()` |
| Components | PascalCase files | `StatusBadge.tsx` |
| Route params | `[id]` folders | `cases/[id]/page.tsx` |

### Import Order

1. React / Next.js
2. Third-party (date-fns, lucide-react)
3. Internal lib (api, queries, auth, permissions)
4. UI components (shadcn)
5. Domain components
6. Types (with `import type`)

### Numeric Display Conventions

Values stored in the database as 0–1 decimals (e.g., `confidence: 0.94`, `approval_rate: 0.78`) must be multiplied by 100 before display:

```typescript
// CORRECT
`${Math.round(item.confidence * 100)}%`    // → "94%"

// WRONG — displays "1%" for any value 0.5–1.0
`${Math.round(item.confidence)}%`          // → "1%"
```

Establish a convention in `lib/utils.ts` for all percentage formatting:

```typescript
export function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
```

### TypeScript Tuple Narrowing

When `domain.config.ts` defines a constant array with `as const` (e.g., `terminalStatuses: ["finalized"] as const`), TypeScript infers a readonly tuple type. Calling `.includes(variable)` where `variable` is the broader union type (e.g., `EntityStatus`) produces a type error because `includes` expects the narrow literal type.

**Fix:** Cast the tuple to `readonly string[]` at the call site:

```typescript
const isTerminal = (DOMAIN.terminalStatuses as readonly string[]).includes(entity.status);
```

### Rule / SOP Criteria Language

Rule criteria stored in the database and displayed in the Rules browser must be written in **plain English with markdown formatting**, not pseudocode or programming syntax. Kognitos is an "English as Code" platform — the rules should read like step-by-step instructions a domain expert would follow.

| Do | Don't |
|----|-------|
| `## Rule Title` / `### Step 1: Check ...` | No headings — wall of text |
| `- Check whether the request amount exceeds threshold` | `IF amount > threshold THEN ...` |
| `- Flag any category marked as high-risk` | `IF category IN ('high_risk') THEN flag` |
| `If documentation supports: approve it.` | `THEN flag_for_review('Check eligibility')` |
| Parsed with `renderCriteria()` into headings + bullets | Raw `<pre>` with `font-mono` |

Use `##`/`###` headings for structure, `-` bullets for lists, `  -` for nested sub-bullets, and numbered lists where order matters. Render with a line-by-line markdown parser (see Section 10.6), not `<pre>` or `whitespace-pre-wrap`.

### New Entity Creation

When a page creates a new entity client-side (e.g., a "New Case" dialog), ensure the default field values match the seed data conventions:
- Use `user.org_id` from the auth context, not a hard-coded fallback
- Set `status` to the initial lifecycle status defined in `domain.config.ts`
- Generate a deterministic or UUID-based `id` following the same prefix pattern as seed data (e.g., `entity-{n}`)
- Set `created_at` and `updated_at` to the current ISO timestamp

### Component Patterns

- Pages are `"use client"` with `useState` + `useEffect` for data fetching
- All data (including query/metrics) fetched via `useEffect` calling async functions
- Batch multiple independent async calls with `Promise.all` in a single `useEffect`
- `useMemo` only for **synchronous** derivations from already-loaded state — never for async calls
- All `useState`/`useEffect` hooks must appear **before** any conditional early returns
- Status badges use a config object mapping status → variant + label
- Cards use shadcn `Card` / `CardHeader` / `CardContent` / `CardTitle`
- Tables use shadcn `Table` or TanStack Table for complex tables
- Tabs use shadcn `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`

### Data Flow

All data loading is async — no synchronous data accessors exist at runtime:

```
Reads:
  Page (useEffect) → API function (async) → lib/db (async) → Supabase PostgreSQL
  Page (useEffect) → Query function (async) → lib/db (async) → Supabase PostgreSQL → JS compute
  Page (useEffect) → Kognitos client (async) → Mock JSON (dev) / Kognitos REST API (prod)

Writes (SOP-routed):
  Action button → createRun(sopId, inputs) → Kognitos SOP → writes to Supabase → refreshEntity()

Writes (Direct CRUD):
  Action button → updateEntity() + insertAuditEvent() → Supabase → refreshEntity()
```

**Anti-pattern — state-only write**: `setEntity({...entity, status: "new_status"})` without a Supabase call. This "works" visually until the user navigates away or refreshes the page, at which point the change is silently lost. Every action must persist before or alongside the state update.

**React hooks rule**: All `useEffect` and `useState` hooks for data loading must be declared **before** any conditional early returns (`if (!data) return null`). Placing a `useEffect` after an early return causes "Rendered more hooks than during the previous render" errors.

```typescript
// CORRECT: all hooks before early returns
const [data, setData] = useState(null);
const [extra, setExtra] = useState(null);

useEffect(() => { fetchData().then(setData); }, []);
useEffect(() => { if (data) fetchExtra(data.id).then(setExtra); }, [data]);

if (!data) return null;  // early return is safe — hooks are already registered

// WRONG: hook after early return
useEffect(() => { fetchData().then(setData); }, []);
if (!data) return null;
useEffect(() => { ... }, [data]);  // ← React error: hook count changes between renders
```

---

## 17. Build Checklist

### Foundation
- [ ] Create Next.js app with TypeScript and Tailwind
- [ ] Install all dependencies
- [ ] Add shadcn components
- [ ] Set up custom fonts and design tokens in globals.css
- [ ] Create directory structure

### Domain Model & Database
- [ ] Define all types in `lib/types.ts`
- [ ] Create Supabase project and link (`supabase link --project-ref <ref>`)
- [ ] Write SQL migration mapping all types to tables (`supabase/migrations/`)
- [ ] Push schema to Supabase (`supabase db push`)
- [ ] Create seed data arrays in `lib/mock-data/` (20-60 records each)
- [ ] Create Kognitos mock data (runs, events, insights, metrics)
- [ ] Ensure run outputs match entity data in tables
- [ ] Write and run `scripts/seed.ts` to populate Supabase
- [ ] Create `lib/supabase.ts` (client from env vars)
- [ ] Create `lib/db.ts` (async data-access layer, Supabase-only, no mock fallback)
- [ ] Add write functions to `lib/db.ts` (`updateEntity`, `insertEntity`, `insertAuditEvent`)
- [ ] Verify `MOCK_USERS` IDs and `org_id` match seed data exactly (no `usr_001` vs `user-1` mismatches)

### API & Auth
- [ ] Create API abstraction layer (`lib/api/`)
- [ ] Export both read **and** write functions from `lib/api/index.ts`
- [ ] Create Kognitos mock client (`lib/kognitos/client.ts`) with `createRun()` for SOP-routed writes
- [ ] Define `SOP_ACTION_MAP` mapping UI action keys → Kognitos SOP IDs
- [ ] Create auth context with localStorage persistence
- [ ] Create role permissions config
- [ ] Create constants (role labels, status labels)

### Core Pages
- [ ] Root layout with AuthProvider
- [ ] Login page with role selector and role-based redirect
- [ ] Dashboard layout with sidebar, topbar, and page guard
- [ ] Sidebar with role-filtered navigation
- [ ] Topbar with search, notifications badge, user dropdown
- [ ] Worklist with filters, table, CSV export, new entity dialog
- [ ] Entity detail with tabbed view and action sidebar
- [ ] Dashboard with KPI cards, charts, tables, drill-down sheets
- [ ] Rules/SOPs browser with detail page
- [ ] Notifications page with SLA alerts
- [ ] Settings page with org info and user management

### Intelligence Layer
- [ ] Async query module (`lib/queries.ts`) — all functions async, fetch from Supabase via `lib/db`
- [ ] Zero hard-coded metrics — every number from a query function or Kognitos API
- [ ] Kognitos analytics data consistent with mock runs
- [ ] SOP Run tab on entity detail page
- [ ] Run History section on rule detail page with expandable rows
- [ ] Predictive scoring
- [ ] Threshold/gold card engine
- [ ] Advanced analytics (trends, breakdowns, productivity)

### RBAC
- [ ] Sidebar filtering by role
- [ ] Login redirects to role-specific default page
- [ ] Page-level access guard in dashboard layout
- [ ] Action-level gating on entity detail page
- [ ] Role-specific worklist (e.g., reviewer sees only items pending their action)
- [ ] Role-aware dashboard (section ordering/visibility)

### Deployment

**Git setup (template origin trap):** When building from the template, the git `origin` remote still points to `kognitos/kognitos-trusted-app-template`. You must create your own repo and change the remote before pushing:

```bash
# Create new repo (e.g., under your org)
gh repo create YOUR_ORG/your-app-name --public --description "..."

# Point origin to the new repo (NOT the template)
git remote set-url origin https://github.com/YOUR_ORG/your-app-name.git
git push -u origin main
```

**Vercel + Supabase deployment:**

- [ ] Create a GitHub repo for the app (separate from the template repo)
- [ ] Change git `origin` remote to the new repo and push
- [ ] Link the Vercel project to the correct team/scope: `vercel link --scope YOUR_TEAM`
- [ ] Set Supabase env vars on Vercel **before the first production deploy** (without them the build succeeds but the app shows blank pages at runtime):
  ```bash
  echo "https://YOUR_PROJECT.supabase.co" | vercel env add NEXT_PUBLIC_SUPABASE_URL production
  echo "your-anon-key" | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
  ```
- [ ] Pull env vars locally for development: `vercel env pull .env.local`
- [ ] Push the Supabase schema: `supabase db push` (both schema and write policy migrations)
- [ ] Seed the database: `SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed.ts`
- [ ] Deploy to Vercel: `vercel --prod --scope YOUR_TEAM`
- [ ] Verify all pages load data from Supabase (no console errors)
- [ ] Verify writes work: perform an action, refresh the page, confirm the change persisted

### Write Persistence (Critical)
- [ ] Every action button in the entity detail page calls either `createRun()` or `updateEntity()` + `insertAuditEvent()` — no state-only updates
- [ ] SOP-routed actions (complex business logic) go through `createRun()` which writes to Supabase internally
- [ ] Direct CRUD actions (simple transitions) call `updateEntity()` then `insertAuditEvent()`
- [ ] After every write (both SOP and CRUD), a `refreshEntity()` helper re-fetches the entity from Supabase to update local state
- [ ] New entity creation via dialog calls `insertEntity()` + `insertAuditEvent()` to persist
- [ ] Audit events are created for **every** action (both SOP-routed and direct CRUD)
- [ ] Test persistence: perform an action, navigate away, navigate back — the change must survive
- [ ] Supabase write policies exist for all tables the UI writes to (`supabase/migrations/`)

### Verification
- [ ] Every non-terminal status has at least one action in the status-aware action panel
- [ ] The initial entity status has actions to advance the workflow (no dead-end on creation)
- [ ] Status-aware actions are gated by both entity status AND user role
- [ ] Kognitos SOP trigger actions (e.g., "Run Auto-Process") simulate processing with loading states
- [ ] Global search works end-to-end: topbar sends URL param, worklist reads and applies it
- [ ] All 0–1 decimal values (confidence, rates) are multiplied by 100 before display
- [ ] Notifications filter correctly by the logged-in user's ID
- [ ] Comments and timeline events display the correct author name (not "Unknown")
- [ ] New entity creation uses `user.org_id` from auth context, not a hard-coded fallback
- [ ] `MOCK_USERS` IDs, org_ids, and roles match seed data in `lib/mock-data/`
- [ ] Rule criteria stored as markdown (## headings, ### steps, - bullets, numbered lists) in plain English — no pseudocode
- [ ] Rule criteria rendered via a `renderCriteria()` parser into headings, bullets, and keyword-highlighted text — not raw `<pre>` or `font-mono`

### Polish
- [ ] Interactive drill-down on all dashboard visualizations
- [ ] URL deep-linking for tabs (?tab=sop-run)
- [ ] Global search navigating to worklist with filter
- [ ] Episode/bundle grouping in worklist
- [ ] Renewal/follow-up management
- [ ] All `useEffect`/`useState` hooks declared before conditional returns
- [ ] All TypeScript compiles cleanly
- [ ] No lint errors
- [ ] Git init and commit

### Acceptance Testing
- [ ] Generate test matrix from domain config (see [Section 19](#19-acceptance-testing))
- [ ] Run every test case — every action writes to Supabase and creates an audit event
- [ ] Verify all changes survive a full page reload
- [ ] Test across all roles defined in `DOMAIN.roles`

---

## 18. User Stories

Before acceptance testing, generate a comprehensive set of user stories that cover every workflow path in the app. User stories serve as the specification for what the acceptance tests must verify.

### 18.1 User Story Format

Each user story follows the standard format:

```
US-[N]: As a [role], I [action] so that [outcome].
```

### 18.2 Deriving User Stories from Domain Config

Generate user stories systematically from the app's configuration:

1. **From `STATUS_ACTIONS`**: For each (status, action) pair, generate a story describing who performs the action and what the expected outcome is
2. **From `DOMAIN.roles`**: For each role, generate stories covering their primary workflows and permission boundaries
3. **From `SOP_ACTION_MAP`**: For each SOP, generate a story describing the AI-assisted workflow
4. **From page features**: For each page (worklist, dashboard, notifications, settings), generate stories covering key user interactions

### 18.3 Lifecycle Stories

Walk one entity through the complete lifecycle across roles. Each step is a user story:

```markdown
US-1: As a [initial_role], I create a new entity so it enters the worklist in the initial status.
US-2: As a [initial_role], I trigger the first SOP so the entity is triaged and categorized with AI predictions.
US-3: As a [initial_role], I assign the entity to a specialist so they can take ownership.
US-4: As a [specialist_role], I trigger the second SOP so the entity progresses with AI-generated artifacts.
US-5: As a [specialist_role], I trigger the third SOP so the entity is submitted for external processing.
US-6: As a [specialist_role], I mark the entity as resolved (positive) so recovery is tracked.
US-7: As a [specialist_role], I mark the entity as resolved (negative) so the loss is recorded.
US-8: As a [manager_role], I write off an entity so it is removed from the active worklist without further action.
US-9: As a [manager_role], I close a resolved entity so it reaches its terminal state.
```

### 18.4 Dashboard & Analytics Stories

```markdown
US-10: As a manager, I view the dashboard to see KPIs, trends, and team performance metrics.
US-11: As a manager, I click a chart segment to drill down into the matching entities.
US-12: As any role, I search for an entity from the topbar and the worklist filters to that result.
```

### 18.5 Notification & Settings Stories

```markdown
US-13: As any role, I receive notifications for approaching deadlines and status changes.
US-14: As an admin, I view and manage domain configuration (users, org settings).
```

### 18.6 Negative / Boundary Stories

```markdown
US-15: As a role without permission, I do NOT see action buttons that require higher privileges.
US-16: As any role, I cannot revert a terminal-status entity to an earlier status.
US-17: As any role, when I perform an action and reload the page, the change persists (not lost).
```

### 18.7 Cross-Role Lifecycle Story

The most important test: walk one entity through the **complete lifecycle** across multiple roles, verifying every transition:

```
1. [initial_role] creates entity → initial_status
2. [initial_role] runs SOP-1 → intermediate_status_1
3. [initial_role] assigns to [specialist_role]
4. [specialist_role] runs SOP-2 → intermediate_status_2
5. [specialist_role] runs SOP-3 → intermediate_status_3
6. [specialist_role] resolves → resolution_status
7. [manager_role] closes → terminal_status
```

Each step must:
- Persist to the database (verified by direct Supabase query)
- Create an audit event with the correct actor_id
- Survive a full page reload

---

## 19. Acceptance Testing

After deployment, generate and execute a full acceptance test suite that verifies every user-facing action creates persistent updates in Supabase. Do not rely on manual spot-checks — systematically test every action in the app.

### 19.1 Generate the Test Matrix

Derive the test matrix automatically from the app's domain config and action definitions. The inputs are:

1. **`STATUS_ACTIONS`** (from the entity detail page) — maps each status to available action buttons
2. **`SOP_ACTIONS` / `SOP_ACTION_MAP`** — which actions route through Kognitos vs direct CRUD
3. **`DOMAIN.roles`** — which roles can perform which actions
4. **`DOMAIN.statuses`** — the full lifecycle

For each combination of (status × action × role), generate a row:

```
| # | Action           | Test Entity | Before Status  | Expected After | Role    | DB Table(s)            | Audit Event Action |
|---|------------------|-------------|----------------|----------------|---------|------------------------|--------------------|
| 1 | Create Entity    | new         | —              | draft          | requester | entities, audit_events | entity_created     |
| 2 | Submit           | ent-1       | draft          | submitted      | requester | entities, audit_events | submitted          |
| 3 | Start Review     | ent-2       | submitted      | under_review   | reviewer  | entities, audit_events | review_started     |
| 4 | Approve          | ent-3       | under_review   | approved       | reviewer  | entities, audit_events | approved           |
| 5 | Reject           | ent-4       | under_review   | rejected       | reviewer  | entities, audit_events | rejected           |
| 6 | Request Changes  | ent-5       | under_review   | draft          | reviewer  | entities, audit_events | changes_requested  |
| 7 | Close            | ent-6       | approved       | closed         | manager   | entities, audit_events | closed             |
| 8 | Assign           | ent-7       | submitted      | (assigned_to)  | manager   | entities, audit_events | assigned           |
```

**Key rules:**
- Every row must name a specific test entity in the correct "Before Status" (use seed data entities or create new ones)
- Every action must be tested with the role that has permission for it
- The terminal status should have no action rows (verify "no further actions" message instead)

### 19.2 Pre-Test: Snapshot the Database

Before running tests, capture a baseline of the database state:

```bash
# Snapshot all entity statuses
curl -s "$SUPABASE_URL/rest/v1/entities?select=id,status,assigned_to&order=id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"

# Count existing audit events
curl -s "$SUPABASE_URL/rest/v1/audit_events?select=id&order=created_at.desc&limit=5" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

### 19.3 Execute Tests

For each row in the test matrix, follow this protocol:

**Step 1: Login as the required role**
Navigate to `/login`, select the role, sign in.

**Step 2: Navigate to the test entity**
Go to `/entities/{id}` and verify the current status matches "Before Status".

**Step 3: Click the action button**
Click the action, wait for "Processing..." to disappear and the UI to update.

**Step 4: Verify in the UI**
- Status badge changed to "Expected After"
- Action buttons changed to match the new status
- For SOP-routed actions: "SOP Run" tab appeared

**Step 5: Verify in Supabase (the critical step)**
Query the database directly to confirm the write persisted:

```bash
# Check entity status
curl -s "$SUPABASE_URL/rest/v1/entities?id=eq.$ENTITY_ID&select=id,status,assigned_to,coded_at,finalized_at" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"

# Check audit event was created
curl -s "$SUPABASE_URL/rest/v1/audit_events?entity_id=eq.$ENTITY_ID&select=id,action,actor_id&order=created_at.desc&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

**Step 6: Reload and re-verify**
Reload the page. The status and data must match what was set in Step 4. If it reverts, the write failed silently.

### 19.4 Post-Test: Verify Audit Trail Completeness

After all tests, query the audit_events table to confirm one event per test action:

```bash
# All audit events created during the test session (filter by timestamp)
curl -s "$SUPABASE_URL/rest/v1/audit_events?created_at=gte.$TEST_START_TIME&select=id,entity_id,action,actor_id&order=created_at" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

Expected: one audit event per test row, each with the correct `entity_id`, `action`, and `actor_id`.

### 19.5 What to Test Beyond Actions

| Area | What to verify |
|------|----------------|
| **Create entity** | New entity dialog inserts a row in `entities` + `audit_events` |
| **Role gating** | Actions that require a specific role do NOT appear for other roles |
| **Terminal status** | Finalized entities show "no further actions" message |
| **Cross-role flow** | Walk one entity through the full lifecycle: requester → reviewer → manager |
| **Page reload** | Every change survives a full browser reload (not just client navigation) |
| **Topbar search** | Search from topbar filters the worklist correctly |
| **Notifications** | Notifications filter by the logged-in user |

### 19.6 Common Failures and Root Causes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Action completes in UI but reverts on reload | State-only update, no Supabase write | Add `updateEntity()` + `insertAuditEvent()` call |
| Write silently fails (no error, no change) | Missing RLS write policy on the table | Add INSERT/UPDATE policies in a migration file |
| Audit event missing for an action | `insertAuditEvent()` call missing from handler | Add it after every `updateEntity()` or `createRun()` |
| Wrong actor_id on audit event | Using hard-coded user ID instead of `user?.id` | Pass `user?.id` from auth context |
| Status changes but related fields don't | `updateEntity` call missing fields like `coded_at` | Include all relevant fields in the update payload |
| Assign action does nothing | `prompt()` returns empty string in some browsers | Use a dialog/modal instead of `prompt()` for user input |
