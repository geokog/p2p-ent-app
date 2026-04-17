# Kognitos Workflow Template

A production-ready template for building workflow management applications with Next.js, Supabase, and Kognitos "English as Code" business logic.

Clone this template and customize it for any domain: **prior authorization**, **claims processing**, **invoice approval**, **contract review**, **employee onboarding**, **compliance audit**, and more.

## Architecture

Three-layer separation of concerns keeps your app thin, your business logic auditable, and your data queryable:

```
┌─────────────────────────────────────────────────┐
│               Presentation Layer                │
│          Next.js / Vercel / shadcn/ui           │
│                                                 │
│  Worklist ─ Detail ─ Dashboard ─ Rules ─ Settings│
└──────────────┬─────────────────┬────────────────┘
               │ API calls       │ SQL queries
               ▼                 ▼
┌──────────────────────┐  ┌─────────────────────────┐
│   Kognitos Platform  │  │   Supabase (PostgreSQL)  │
│   English-as-Code    │  │   Domain tables           │
│   SOPs & Runs        │  │   Metrics via SQL         │
└──────────────────────┘  └─────────────────────────┘
```

- **Presentation** (this app): Next.js + shadcn/ui on Vercel. Handles UI, routing, state, and data display. Does NOT encode business rules.
- **Business Logic** (Kognitos): English-as-Code SOPs that are API-callable. Each SOP handles one step of your workflow. Edge cases are handled inside the SOPs, not in TypeScript.
- **Data** (Supabase): PostgreSQL tables store domain entities, cached Kognitos run JSON, and denormalized file-input metadata. SQL queries compute metrics and aggregates.

## What's Included

| Feature | Description |
|---------|-------------|
| **Worklist** | Search, multi-filter, sorting, pagination, CSV export, row-click navigation |
| **Entity Detail** | Tabbed view with overview, documents, timeline, SOP run visibility, and action sidebar |
| **Analytics Dashboard** | KPI cards, Recharts visualizations, interactive drill-down sheets |
| **Rules/SOP Browser** | View SOP definitions, execution history, per-rule metrics |
| **RBAC** | 4 config-driven roles (requester, reviewer, manager, admin) with path and action gating |
| **Notifications** | Bell icon with unread count, SLA breach alerts, full notification page |
| **Settings** | Organization info, user management, domain configuration |
| **Supabase Integration** | Schema migrations (`supabase/migrations`), seed script, data-access layer |
| **Kognitos run storage** | `kognitos_runs` (raw ListRuns/GetRun JSON) and `kognitos_run_inputs` (file refs from `user_inputs` / steps) — see `lib/kognitos/openapi.yaml` |
| **Kognitos sync** | Topbar refresh imports new automation runs from the Kognitos API into Supabase (`POST /api/kognitos/sync`) |
| **Kognitos Mock Client** | Default typed mocks for dashboard and demos; entity detail can load stored runs from Supabase when present |
| **Domain Config** | Single file (`lib/domain.config.ts`) controls app name, statuses, roles, and navigation |

## Quick Start

### 1. Create Your Repository

Click **"Use this template"** on GitHub, then clone your new repo:

```bash
git clone https://github.com/YOUR_ORG/your-workflow-app.git
cd your-workflow-app
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Supabase

Create a [Supabase](https://supabase.com) project, then link it locally:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Push the schema to your database:

```bash
npx supabase db push
```

### 4. Configure Environment Variables

Copy the example file and fill in values for Supabase and (optionally) Kognitos:

```bash
cp .env.local.example .env.local
```

At minimum, set **Supabase** so the app, seed script, and Kognitos API routes can talk to your project:

- `NEXT_PUBLIC_SUPABASE_URL` — project URL  
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon/public key (browser)  
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server only: `npm run seed`, `/api/kognitos/*`, never expose to the client)

You can find these under Supabase **Project Settings → API**. If you use Vercel with the Supabase integration, the `NEXT_PUBLIC_*` vars are often injected for you; you still need to add `SUPABASE_SERVICE_ROLE_KEY` in Vercel for sync and seeding.

**Kognitos API** (required for importing real runs from the Kognitos API):

- `KOGNITOS_BASE_URL` — API base URL (no trailing slash)  
- `KOGNITOS_API_KEY` — bearer token  
- `KOGNITOS_ORGANIZATION_ID` — organization id  
- `KOGNITOS_WORKSPACE_ID` — workspace id  
- `KOGNITOS_AUTOMATION_ID` — **optional.** When set, the app can insert one registered automation at runtime on first status/sync so the **first-time onboarding dialog may be skipped**. When unset, an **admin** completes in-app onboarding to pick automations after deploy.

Without the base URL / token / org / workspace, the UI still works using the mock Kognitos client; the **Refresh** button in the top bar will report that Kognitos env is not configured.

### 5. Seed the Database

The seed script reads `.env.local` and upserts organizations, users, requests, **`kognitos_automations`** (seed automation) and **`kognitos_runs`** placeholder rows (so foreign keys line up), and related data:

```bash
npm run seed
```

Equivalent: `SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/seed.ts`

### 6. Run the Dev Server

```bash
npm run dev
```

If port **3000** is already in use (for example after a redeploy), free it and restart:

```bash
npm run dev:restart
```

Open [http://localhost:3000](http://localhost:3000). Log in with any role to explore the app.

**First visit:** If no automations are registered yet (for example you removed seed data or started from an empty table), an **admin** sees a one-time **onboarding dialog** to choose workspace automations (skipped when `KOGNITOS_AUTOMATION_ID` bootstrap applies). Other roles see a **setup pending** screen until an admin finishes onboarding.

## Customizing for Your Domain

See **[docs/CUSTOMIZING.md](docs/CUSTOMIZING.md)** for a step-by-step guide that walks you through adapting every layer of the template.

The key file to start with is **`lib/domain.config.ts`** — it controls:

- App name and branding
- Entity names (singular/plural)
- Status lifecycle and badge colors
- Roles, permissions, and default paths
- Sidebar navigation items

Most of the UI reads from this single config, so a quick edit there changes the entire app.

## Kognitos integration (runs and inputs)

This template is set up so you can treat Kognitos as the source of truth for automation runs while keeping queryable data in Postgres.

- **`kognitos_runs`** stores each run’s **raw API JSON** (`payload` jsonb), matching ListRuns/GetRun shapes so fields like `user_inputs` / `userInputs` and nested `file` objects stay intact. The bundled [`lib/kognitos/openapi.yaml`](lib/kognitos/openapi.yaml) is the reference contract.
- **`kognitos_run_inputs`** holds **denormalized rows** for file-shaped inputs (normalized file id, optional filename and `remote_raw`) so you can join and filter without parsing JSON everywhere. Rows are rebuilt whenever a new run is imported or when you run the payload refresh script.

**Import runs from Kognitos:** use the **refresh icon** in the top bar (next to notifications). It calls `POST /api/kognitos/sync`, which loops **registered automations** in Supabase, paginates ListRuns per automation, inserts new rows with the correct automation link, and reindexes inputs (incremental per automation using the latest stored `create_time`). Requires Supabase service role + Kognitos base URL, token, org, and workspace (see above). Admins can register automations in onboarding or **Settings**.

**Manual cleanup (Supabase only):** To remove synced data, use the SQL editor with a role that can delete from these tables. **Back up first.** Delete one automation by short id (same as in API paths / env):

```sql
DELETE FROM kognitos_automations
WHERE automation_id = 'your-automation-id';
```

Full reset of registered automations and all synced runs/inputs tied to them:

```sql
DELETE FROM kognitos_automations;
```

Deleting automation rows cascades to related runs and inputs; `requests.kognitos_run_id` is cleared when runs are removed.

**Repair stored payloads:** if you previously stored mapped runs and need full `file.remote` paths, run:

```bash
npm run refresh:run-payloads
```

That re-fetches each run via GET Run, updates `kognitos_runs.payload`, and reindexes `kognitos_run_inputs`.

**UI behavior:** [`lib/kognitos/client.ts`](lib/kognitos/client.ts) provides mocks for list runs, events, and metrics so the dashboard works out of the box. For **get run** on the entity detail page, the client first requests **`GET /api/kognitos/runs/[id]`** (stored row); if none exists, it falls back to the mock run. Point `requests.kognitos_run_id` at a stored id after sync, or keep using mock ids that match the seed data.

## Data table module (filterable list tables)

For new screens that need the **card → toolbar → bordered table → pagination** pattern (for example, analyzed vs on-hold invoice-style lists), use [`components/data-table`](components/data-table/index.ts):

| Export | Role |
|--------|------|
| `DataTableCard` | `Card` with title + description |
| `DataTableToolbar` | Responsive flex row for tabs, selects, filter popovers |
| `DataTablePagination` | “Showing X–Y of Z”, rows-per-page `Select` (10 / 25 / 50), first/prev/next/last |
| `DataTableEmpty` | Centered empty state copy |
| `useDataTablePaging` | Client-side page index, `rowsPerPage`, slice, clamp when data shrinks |
| `useStickyActionsColumn` | Scroll tracking for a **sticky right “Actions”** column (pair with class helpers below) |
| `dataTableShellClassName` | `Table` `className` for row borders + `border-separate` (horizontal scroll + sticky columns) |
| `dataTableStickyActionsHeadClassName` / `dataTableStickyActionsCellClassName` | Sticky Actions header/cell (pass `stacked` from the hook) |
| `dataTableActionIconButtonClassName` | Emerald-hover outline icon buttons in Actions |

[`components/ui/table.tsx`](components/ui/table.tsx) **`Table`** forwards its `ref` to the scroll container `div`, so attach `ref={sticky.setTableScrollContainer}` for the sticky column behavior.

The main worklist still uses [TanStack Table](https://tanstack.com/table) in [`components/worklist/worklist-table.tsx`](components/worklist/worklist-table.tsx); use the data-table module when you want the **invoice-style** layout and manual column markup instead of column defs.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) | SSR, routing, server components |
| UI Components | [shadcn/ui](https://ui.shadcn.com) + Radix UI | Accessible component primitives |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) | Utility-first CSS |
| Tables | [TanStack Table](https://tanstack.com/table) | Sorting, filtering, pagination |
| Charts | [Recharts](https://recharts.org) | Dashboard visualizations |
| State | [Zustand](https://zustand.docs.pmnd.rs) | Client-side state management |
| Dates | [date-fns](https://date-fns.org) | Date formatting and math |
| Icons | [Lucide React](https://lucide.dev) | Consistent iconography |
| Database | [Supabase](https://supabase.com) (PostgreSQL + Auth) | Data storage and authentication |
| Business Logic | [Kognitos](https://kognitos.com) | English-as-Code SOP execution |

## Project Structure

```
workflow-template/
├── app/
│   ├── api/
│   │   └── kognitos/
│   │       ├── sync/route.ts             # POST — sync runs from Kognitos → Supabase
│   │       └── runs/[id]/route.ts       # GET — map stored `kognitos_runs.payload` for the UI
│   ├── layout.tsx                        # Root layout (AuthProvider, fonts)
│   ├── globals.css                       # Tailwind imports, theme tokens
│   ├── (auth)/
│   │   └── login/page.tsx                # Login with role selector
│   └── (dashboard)/
│       ├── layout.tsx                    # Sidebar + Topbar + RBAC guard
│       ├── page.tsx                      # Worklist (default landing)
│       ├── requests/[id]/page.tsx       # Request detail (tabbed)
│       ├── dashboard/page.tsx            # Analytics dashboard
│       ├── rules/page.tsx                # SOP/Rules browser
│       ├── rules/[id]/page.tsx           # Rule detail + run history
│       ├── notifications/page.tsx        # Notification history
│       └── settings/                     # Org settings, users, config
├── components/
│   ├── layout/                           # Sidebar, Topbar
│   ├── data-table/                       # Card + toolbar + pagination + sticky Actions helpers
│   ├── ui/                               # shadcn/ui primitives
│   ├── domain/                           # Status badge, priority badge, etc.
│   └── worklist/                         # Filters, TanStack table
├── lib/
│   ├── domain.config.ts                  # ★ Central domain configuration
│   ├── types.ts                          # All TypeScript types
│   ├── constants.ts                      # Labels and mappings
│   ├── utils.ts                          # cn() and helpers
│   ├── supabase.ts                       # Supabase client
│   ├── db.ts                             # Data-access layer (Supabase)
│   ├── queries.ts                        # Async analytics query functions
│   ├── auth-context.tsx                  # React Context for auth
│   ├── role-permissions.ts               # RBAC config (reads domain.config)
│   ├── api/                              # API abstraction (re-exports db.ts)
│   ├── kognitos/                         # Mock client, server `client-core`, sync, run mapping, `openapi.yaml`
│   └── seed-data/                        # Seed data arrays (includes `kognitos_runs`)
├── supabase/
│   ├── config.toml                       # Supabase CLI project config
│   └── migrations/                     # PostgreSQL schema
├── scripts/
│   ├── seed.ts                           # Database seeder
│   ├── refresh-kognitos-run-payloads.ts  # Re-fetch GET Run for all stored ids
│   └── dev-restart.sh                    # Free port 3000 and run `next dev`
└── docs/
    ├── BLUEPRINT.md                      # Full architecture documentation
    └── CUSTOMIZING.md                    # Domain customization guide
```

## Architecture Guide

See **[docs/BLUEPRINT.md](docs/BLUEPRINT.md)** for the complete architecture documentation, including:

- Philosophy and separation of concerns
- Phase-by-phase build guide
- Data flow patterns
- Component conventions
- RBAC enforcement points
- Build checklist

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server |
| `npm run dev:restart` | Stop the process listening on port 3000, then start the dev server on 3000 |
| `npm run build` | Build for production |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run seed` | Seed the Supabase database (loads `.env.local`) |
| `npm run refresh:run-payloads` | Re-fetch each stored run from Kognitos GET Run and refresh inputs |
| `npx supabase db push` | Push schema migrations to your linked Supabase project |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — seed, `/api/kognitos/*`; **never** expose in the browser or client bundles |
| `KOGNITOS_BASE_URL` | Kognitos API base URL (no trailing slash) |
| `KOGNITOS_API_KEY` | Bearer token for Kognitos API |
| `KOGNITOS_ORGANIZATION_ID` | Organization id |
| `KOGNITOS_WORKSPACE_ID` | Workspace id |
| `KOGNITOS_AUTOMATION_ID` | Automation whose runs are listed and stored |

## License

MIT
