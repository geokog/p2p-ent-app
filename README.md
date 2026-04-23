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

### Automation run outputs (retrieve for insights)

Dashboard KPIs, **Runs analyzed**, **Expert Queue**, validation columns (DOC / QTY / VAL / COA / PAY), supplier-invoice IDs, and PDF links are all derived from **the same source of truth: the run’s full JSON**, not from a trimmed UI DTO. Treat **`kognitos_runs.payload`** as the canonical automation output when building or debugging insights.

**What “output” means in the stored JSON**

- **`user_inputs` / `userInputs`** — values and file refs the automation was invoked with (often includes nested `file` / protobuf-style scalars).
- **`outputs`** (top-level on the run object) — automation-emitted fields when the platform surfaces them at the root.
- **`state.completed.outputs`** — the usual place for **completed** automation products: status strings, `payment_recommendation`, explicit `*_ok` flags, **`markdown_report`** (SAP-style narrative + pipe tables such as **Validation Results** / **Value Match**), and any other keys your SOP writes. The sync stores the **entire** GetRun/ListRuns document in `payload`, so nothing is dropped at ingest.

**How this repo reads outputs for insights**

- **Merged outputs** (completed wins over top-level): the same merge pattern appears as `getMergedOutputsForPaymentText` in [`lib/kognitos/normalize-dashboard-run.ts`](lib/kognitos/normalize-dashboard-run.ts) (used for payment text and invoice resolution) and as `mergedOutputsFromPayload` in [`lib/kognitos/validation-from-automation-output.ts`](lib/kognitos/validation-from-automation-output.ts) (validation / VAL from **Validation Results** in JSON or markdown).
- **Normalization for tables and KPIs**: [`lib/kognitos/normalize-dashboard-run.ts`](lib/kognitos/normalize-dashboard-run.ts) (`normalizeKognitosRowForDashboard`, `inferValidationChecks`, invoice/value/vendor heuristics).
- **Markdown tables inside `markdown_report`**: [`lib/kognitos/markdown-report-supplier-invoice.ts`](lib/kognitos/markdown-report-supplier-invoice.ts) (e.g. supplier invoice document id) and validation logic that scans markdown for **Value Match** rows.

**How to retrieve outputs (pick one)**

1. **Supabase (full `payload`, best for analysis)**  
   ```sql
   SELECT id, payload
   FROM kognitos_runs
   WHERE id = 'YOUR_RUN_SHORT_ID';
   ```  
   The `id` column is the **short run id** (same segment used in Kognitos run URLs and `GET …/runs/{id}` paths). Inspect `payload` in the SQL editor or export JSON for offline scripts.

2. **Kognitos REST API (live or when DB is empty)**  
   Server helpers in [`lib/kognitos/client-core.ts`](lib/kognitos/client-core.ts): **`getRun(runId)`** (single run), **`listRunsRaw` / `listAllRunsForAutomationRaw`** (unmapped JSON so nested `file` / outputs match what you store). Paths follow `openapi.yaml`:  
   `GET /api/v1/organizations/{org}/workspaces/{ws}/automations/{automation_id}/runs/{run_id}`.

3. **CLI script (quick inspection)**  
   With `KOGNITOS_*` env vars set (see [Environment Variables](#environment-variables)):
   ```bash
   npm run kognitos:read-output -- --run YOUR_RUN_SHORT_ID
   ```  
   Source: [`scripts/kognitos-read-automation-output.ts`](scripts/kognitos-read-automation-output.ts) — prints the **raw** Get Run JSON. Omit `--run` to print automation metadata plus a few recent runs with `userInputs` and `state.completed.outputs`.

4. **Refresh stored payloads from Kognitos**  
   If `payload` is stale or missing nested file paths:
   ```bash
   npm run refresh:run-payloads
   ```  
   Re-fetches each stored id via GET Run and updates `kognitos_runs.payload` plus `kognitos_run_inputs` (see [`scripts/refresh-kognitos-run-payloads.ts`](scripts/refresh-kognitos-run-payloads.ts)).

5. **App HTTP API (normalized, not the full blob)**  
   - `GET /api/kognitos/runs` — dashboard-ready rows (derived fields, URLs); use for UI parity checks, not for mining arbitrary output keys.  
   - `GET /api/kognitos/runs/[id]` — maps `payload` through [`lib/kognitos/map-run.ts`](lib/kognitos/map-run.ts) to the **`KognitosRun`** shape (focused on stage/state/user inputs). **It does not re-expose the entire `outputs` tree**; for deep output inspection, use (1)–(3) above.  
   - `GET /api/kognitos/runs/[id]/payload` — returns the **raw** `payload` JSON for that stored run (used by the **Runs / Invoices analyzed** validation icons to open the markdown validation report in a dialog).

**IDP invoice PDF field highlights (bounding boxes):** the Expert Queue invoice dialog loads that same raw `payload` and parses IDP `extracted_field` rows for overlays. Full path notes, numeric decoding, and a reuse checklist live in [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md).

### Bounding box field details: where they live, how to unwrap them, and how to render them

This section is for engineers implementing (or extending) **extracted fields**, **bounding boxes**, **coordinates**, **confidence**, and **page** alignment in the document preview. It is grounded only in what this repository implements today.

**Canonical JSON path (matches [`lib/kognitos/idp-invoice-field-highlights.ts`](lib/kognitos/idp-invoice-field-highlights.ts) and [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md)):**

1. Start from the **run document** stored in `kognitos_runs.payload` (same object returned as `payload` from `GET /api/kognitos/runs/[id]/payload`).
2. **`getOutputs`:** `payload.state.completed.outputs` — if `state`, `completed`, or `outputs` is missing, IDP parsing returns `[]` (no fallback to top-level `outputs` or `user_inputs` / `userInputs` in this module).
3. **`getIdpRoot`:** under that `outputs` object, the IDP node is `outputs.idp_extraction_results` **or** `outputs.idpExtractionResults`.
4. **IDP struct entries:** `(idpNode.dictionary.entries || idpNode.entries)` as the protobuf-style map rows `{ key, value }`.
5. **`fields` list:** `protoMapGet(topEntries, "fields")` → `fieldsValue`; the parser sets `items` to **`fieldsValue.list?.items ?? fieldsValue.items`** only (see `parseIdpInvoiceFieldHighlights` in the same file). If real payloads nest list items under an extra `value` wrapper, the parser does not unwrap that today—extend the module and update [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md) accordingly.
6. **Each list item:** `item.dictionary.entries` → `entryListToValueMap`; keep rows where `element_type` or `elementType` (text, case-insensitive) is **`extracted_field`**. Per-field keys read in `parseOneFieldItemWithTrace`: `name` (via `readNameFromMappedValue`), `values` (first list item text), `page_number` / `pageNumber`, `confidence`, `bounding_box` / `boundingBox` (inner `dictionary.entries` for `x`, `y`, `width`, `height`).

**Separate path (document label only, not bboxes):** `extractInvoiceDocumentFileLabel` reads `payload.userInputs` / `payload.user_inputs` → `.invoice.file.remote` for a display filename default.

#### Source of truth: database vs denormalized tables

| Store | Role for bounding boxes |
|-------|---------------------------|
| **`kognitos_runs.payload`** (`jsonb`) | **Canonical.** Full ListRuns/GetRun-shaped JSON. IDP extraction results, per-field **bounding boxes**, **confidence**, **page**, and **values** live inside this blob under `state.completed.outputs` (see below). |
| **`kognitos_run_inputs`** | **Not** the source for bbox geometry. Rows denormalize **file-shaped inputs** (keys, `kognitos_file_id`, filenames, `remote_raw`) for joins and filters—see [`supabase/migrations/00000000000004_kognitos_runs.sql`](supabase/migrations/00000000000004_kognitos_runs.sql). |

There is **no** separate Postgres column for “highlights”; everything is read from **`payload`**.

#### How the app retrieves the payload for a run

- **Browser / Next client:** `GET /api/kognitos/runs/{id}/payload` → JSON body `{ payload: <object> }`. Implemented in [`app/api/kognitos/runs/[id]/payload/route.ts`](app/api/kognitos/runs/[id]/payload/route.ts). The handler `select("payload").eq("id", id)` from `kognitos_runs` and returns the row unchanged (no reshaping of IDP).
- **Invoice PDF bytes (same run row):** `GET /api/kognitos/runs/{id}/invoice-pdf` in [`app/api/kognitos/runs/[id]/invoice-pdf/route.ts`](app/api/kognitos/runs/[id]/invoice-pdf/route.ts)—also reads `kognitos_runs.payload` to resolve which file to download.
- **Trimmed run DTO (not for bboxes):** `GET /api/kognitos/runs/[id]` maps through [`lib/kognitos/map-run.ts`](lib/kognitos/map-run.ts) to `KognitosRun`. That path is **not** where IDP field lists or bounding boxes are exposed; use the **`/payload`** route for automation output mining.

**Staleness:** [`scripts/refresh-kognitos-run-payloads.ts`](scripts/refresh-kognitos-run-payloads.ts) (`npm run refresh:run-payloads`) re-fetches GET Run for each stored id via [`lib/kognitos/refresh-run-payloads.ts`](lib/kognitos/refresh-run-payloads.ts) and updates `kognitos_runs.payload` plus `kognitos_run_inputs`.

#### Step-by-step: locate bounding box data from a run id

1. **Resolve the run id**  
   Use the short run id stored in `kognitos_runs.id` (same segment as in API paths—see [How to retrieve outputs](#automation-run-outputs-retrieve-for-insights)).

2. **Query Postgres**  
   ```sql
   SELECT id, payload
   FROM kognitos_runs
   WHERE id = 'YOUR_RUN_SHORT_ID';
   ```  
   Inspect `payload` in the Supabase SQL editor or export JSON.

3. **Navigate inside `payload` (IDP path used by this repo)**  
   The parser [`parseIdpInvoiceFieldHighlights`](lib/kognitos/idp-invoice-field-highlights.ts) expects the **root** argument to be the **run object** (what is stored in `payload`), not wrapped in an extra `{ payload: … }` layer.

   - **`user_inputs` / `userInputs`:** Used in this repo for **invoice file label** metadata (`extractInvoiceDocumentFileLabel` walks `userInputs` / `user_inputs` → `invoice` → `file` → `remote`). **Bounding boxes for IDP extracted fields are not read from here.**
   - **Top-level `outputs`:** Other dashboard code merges top-level vs completed outputs for payment text and validation (see [`lib/kognitos/normalize-dashboard-run.ts`](lib/kognitos/normalize-dashboard-run.ts)). **The IDP highlight parser does not use that merge**; it uses **`state.completed.outputs` only** via `getOutputs` in [`lib/kognitos/idp-invoice-field-highlights.ts`](lib/kognitos/idp-invoice-field-highlights.ts).
   - **`state.completed.outputs`:** **Branch used for IDP.** `getOutputs` returns `payload.state.completed.outputs` or `null` if missing.

4. **IDP root under `outputs`**  
   From `outputs`, the IDP node is **`idp_extraction_results`** or **`idpExtractionResults`** (`getIdpRoot` in the same file).

5. **`fields` list and `extracted_field` rows**  
   Under the IDP root, entries are protobuf-style maps (`dictionary.entries` or `entries`). The **`fields`** entry’s value is a **list** of items (`list.items` or `items`). Each item is again a map; only rows whose **`element_type` / `elementType`** text equals **`extracted_field`** (case-insensitive) are turned into highlights. Detailed column-style documentation: [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md).

6. **Per-field representation (after parsing)**  
   Successful rows become [`IdPdfFieldHighlight`](lib/kognitos/idp-invoice-field-highlights.ts):

   - **Field name:** `label` (from the `name` entry; blocklisted names are skipped—see `shouldSkipFieldName` / `NAME_BLOCKLIST` in that file).
   - **Field value:** `value` (from `values`, first list item text when present).
   - **Page:** `pageNumber` (1-based integer from `page_number` / `pageNumber`; invalid or missing page causes the row to be skipped).
   - **Confidence:** `confidence` (`number | null` from `confidence`; may be absent).
   - **Bounding box / coordinates:** `bbox` `{ x, y, width, height }` from `bounding_box` / `boundingBox` inner `dictionary.entries`; decoded with `readNumberFromValueMapEntry` (supports protobuf wrappers and C# `Decimal`-style `{ lo, hi, mid?, flags? }`).
   - **Coordinate mode:** `bboxCoordMode` — `"normalized"` vs `"pdf_points"` from `inferBboxOverlayCoordMode` (same file).

   Rows without a valid bbox or with wrong `element_type` produce **`highlight: null`** but still contribute to optional parse traces when `IDP_HIGHLIGHT_FIELD_DEBUG=1`.

**Verification if your payload differs:** If your automation stores IDP under different keys, [`getOutputs`](lib/kognitos/idp-invoice-field-highlights.ts) / [`getIdpRoot`](lib/kognitos/idp-invoice-field-highlights.ts) (and list resolution for `fields`) must be extended; [`getIdpHighlightPayloadDiagnostics`](lib/kognitos/idp-invoice-field-highlights.ts) plus server logs in the payload route help confirm whether the expected branches match real JSON.

### How to unwrap the payload

1. **Fetch** `{ payload }` from `GET /api/kognitos/runs/{id}/payload` (or read `kognitos_runs.payload` in SQL).
2. **Assert shape:** `payload` must be a plain object (`typeof payload === "object"` and not an array)—same guard as [`components/kognitos/invoice-pdf-highlight-viewer.tsx`](components/kognitos/invoice-pdf-highlight-viewer.tsx).
3. **Parse:** call **`parseIdpInvoiceFieldHighlights(payload as Record<string, unknown>)`** → `IdPdfFieldHighlight[]`. Do not reimplement bbox decoding unless you have a new contract; the module already handles **`unwrapProtoValueLayers`**, nested **`value`** wrappers, **`readTextFromValueMapEntry`**, **`readNumberFromValueMapEntry`**, and **`decodeCSharpDecimalLoMidHiFlags`**.
4. **Optional diagnostics:** **`getIdpHighlightPayloadDiagnostics(payload)`** returns counts (`hasIdpExtractionResults`, `fieldsListItemsLength`, `extractedFieldItemsCount`, `normalizedHighlightsCount`) without requiring every field to parse cleanly—used in the payload GET route for logging.

**Normalizing for UI:** the repo’s canonical UI type for one highlight is **`IdPdfFieldHighlight`**. A thin adapter is only needed if your view model differs—for example:

```ts
import type { IdPdfFieldHighlight } from "@/lib/kognitos/idp-invoice-field-highlights";

export type ExtractedFieldRow = {
  id: string;
  fieldName: string;
  fieldValue: string;
  confidence: number | null;
  page: number;
  bbox: IdPdfFieldHighlight["bbox"];
  bboxCoordMode: IdPdfFieldHighlight["bboxCoordMode"];
};

export function toExtractedFieldRow(h: IdPdfFieldHighlight): ExtractedFieldRow {
  return {
    id: h.id,
    fieldName: h.label,
    fieldValue: h.value,
    confidence: h.confidence,
    page: h.pageNumber,
    bbox: h.bbox,
    bboxCoordMode: h.bboxCoordMode,
  };
}
```

**Missing or malformed data (parser behavior):**

- **Missing confidence:** stored as `null`; UI can use [`formatConfidenceForTooltip`](lib/kognitos/idp-invoice-field-highlights.ts) for display rules.
- **Missing / invalid bbox or page:** row is omitted from the array (`parseOneFieldItemWithTrace` sets `skipReason`).
- **Not every list item is an extracted field:** only `element_type === "extracted_field"` rows become highlights.

**Avoid brittle coupling:** depend on **`parseIdpInvoiceFieldHighlights`** and **`IdPdfFieldHighlight`** rather than hard-coding deep JSON paths in UI code; when Kognitos changes shape, update the **single parser module** and diagnostics.

### How to implement the UI correctly

1. **Fetch raw payload**  
   Client: `fetch(\`/api/kognitos/runs/${encodeURIComponent(runId)}/payload\`)`, then `const { payload, error } = await res.json()` and validate `payload` is an object (see [`InvoicePdfHighlightViewer`](components/kognitos/invoice-pdf-highlight-viewer.tsx)).

2. **Transform for overlays**  
   `const highlights = parseIdpInvoiceFieldHighlights(payload as Record<string, unknown>)`. Pass **`maxCssWidth` / zoom** and **`pageHighlights`** filtered by active page into the PDF page component pattern in [`components/kognitos/invoice-pdf-highlight-viewer.tsx`](components/kognitos/invoice-pdf-highlight-viewer.tsx) (`PdfPageWithHighlights`, `HighlightOverlay`, shared `layoutForZoom` / `bboxCoordMode`).

3. **Right-hand extracted fields panel**  
   Reuse or mirror **`ExtractedFieldsReviewPanel`** in the same file: same **`IdPdfFieldHighlight[]`** drives rows; **`linkedHoverFieldId` / `focusedFieldId`** and pointer handlers keep **rows** and **bounding boxes** in sync.

4. **Missing data in UI**  
   Empty parse result → show an empty state (viewer shows a short message when `parsedHighlights.length === 0`). Rows with null confidence still render; bbox-only interaction applies only to highlights that exist.

5. **Debugging**  
   - Server: set **`IDP_HIGHLIGHT_FIELD_DEBUG=1`** for `[idp-field-parse]` traces (see [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md)).  
   - Client bbox decode logs: **`NEXT_PUBLIC_IDP_BBOX_LOG=1`** is read in [`lib/kognitos/idp-invoice-field-highlights.ts`](lib/kognitos/idp-invoice-field-highlights.ts) (`idpBboxLogEnabled`); **verify** your Next bundle exposes this env to the client if you rely on it in the browser.  
   - Payload GET always logs a one-line summary in [`app/api/kognitos/runs/[id]/payload/route.ts`](app/api/kognitos/runs/[id]/payload/route.ts).

**Generic protobuf walking elsewhere:** [`lib/kognitos/idp-protobuf-extracted.ts`](lib/kognitos/idp-protobuf-extracted.ts) walks subtrees for other extraction-style JSON; IDP PDF highlights use the **dedicated** `idp-invoice-field-highlights.ts` parser.

### Implementation checklist

- [ ] **Database:** confirm `kognitos_runs.id` and `SELECT payload FROM kognitos_runs WHERE id = ?`.
- [ ] **Payload retrieval:** use **`GET /api/kognitos/runs/[id]/payload`** (or Supabase admin server-side) — not **`GET /api/kognitos/runs/[id]`** alone for full IDP trees.
- [ ] **Extraction parsing:** `parseIdpInvoiceFieldHighlights` on the raw run object.
- [ ] **Normalization:** map `IdPdfFieldHighlight` to your table row type if needed; keep **`id`** stable for row ↔ overlay linking.
- [ ] **Overlay rendering:** reuse **`PdfPageWithHighlights`** / mask / bbox layering; respect **`bboxCoordMode`** and PDF.js viewport scale (see viewer source).
- [ ] **Side panel:** bind list to the **same array** as overlays; hover/click ids must match **`IdPdfFieldHighlight.id`**.
- [ ] **Empty states:** no IDP root, empty `fields`, or zero successful parses.
- [ ] **Debugging:** diagnostics helper + env vars + payload route logs.
- [ ] **Validation:** compare `getIdpHighlightPayloadDiagnostics` counts to `parseIdpInvoiceFieldHighlights(...).length` on real stored payloads.

### Files to inspect

| File | Why |
|------|-----|
| [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md) | Path reference, protobuf map shapes, debug env vars. |
| [`lib/kognitos/idp-invoice-field-highlights.ts`](lib/kognitos/idp-invoice-field-highlights.ts) | **`parseIdpInvoiceFieldHighlights`**, **`getIdpHighlightPayloadDiagnostics`**, **`IdPdfFieldHighlight`**, **`getOutputs`**, **`getIdpRoot`**, bbox decode, **`inferBboxOverlayCoordMode`**, **`formatConfidenceForTooltip`**, **`formatHighlightTooltip`**, **`entryListToValueMap`**. |
| [`app/api/kognitos/runs/[id]/payload/route.ts`](app/api/kognitos/runs/[id]/payload/route.ts) | Raw payload HTTP surface + diagnostic logging. |
| [`app/api/kognitos/runs/[id]/invoice-pdf/route.ts`](app/api/kognitos/runs/[id]/invoice-pdf/route.ts) | Same DB row; PDF download for the same run. |
| [`components/kognitos/invoice-pdf-highlight-viewer.tsx`](components/kognitos/invoice-pdf-highlight-viewer.tsx) | End-to-end viewer: fetch payload, parse, PDF.js, overlays, right panel, zoom, toolbar. |
| [`app/(dashboard)/expert-queue/page.tsx`](app/(dashboard)/expert-queue/page.tsx) | Document Processing dialog embedding the viewer. |
| [`components/kognitos/kognitos-runs-analyzed-table.tsx`](components/kognitos/kognitos-runs-analyzed-table.tsx) | Same viewer in Runs analyzed flow. |
| [`lib/kognitos/run-payload.ts`](lib/kognitos/run-payload.ts) | **`userInputs` / `user_inputs`** helpers (not bbox source; shows camel/snake pattern). |
| [`lib/kognitos/map-run.ts`](lib/kognitos/map-run.ts) | API → `KognitosRun` mapping (**not** for raw IDP bbox mining). |
| [`lib/kognitos/client-core.ts`](lib/kognitos/client-core.ts) | **`getRun`**, **`listRunsRaw`**, **`listAllRunsForAutomationRaw`** for live API JSON shapes. |
| [`lib/kognitos/openapi.yaml`](lib/kognitos/openapi.yaml) | Contract reference for run / user_inputs shapes. |
| [`scripts/refresh-kognitos-run-payloads.ts`](scripts/refresh-kognitos-run-payloads.ts) | CLI entry for refreshing stored payloads. |
| [`lib/kognitos/refresh-run-payloads.ts`](lib/kognitos/refresh-run-payloads.ts) | Implementation used by the script. |
| [`lib/kognitos/normalize-dashboard-run.ts`](lib/kognitos/normalize-dashboard-run.ts) | Merged **`outputs`** patterns for dashboard text (distinct from IDP bbox parser). |
| [`lib/kognitos/markdown-report-supplier-invoice.ts`](lib/kognitos/markdown-report-supplier-invoice.ts) | Markdown report parsing (not bbox geometry). |
| [`lib/kognitos/idp-protobuf-extracted.ts`](lib/kognitos/idp-protobuf-extracted.ts) | Generic subtree walking for other extraction JSON. |

### Common mistakes to avoid

- **Using `GET /api/kognitos/runs/[id]` (mapped `KognitosRun`) as the source for bounding boxes** — that response does not carry the full `state.completed.outputs` IDP field list; use **`/payload`** or SQL on **`kognitos_runs.payload`**.
- **Assuming every `fields` list item has a bounding box** — the parser drops rows when **`parseBoundingBox`** fails or **`element_type`** is not **`extracted_field`**.
- **Assuming coordinates are always normalized `[0,1]`** — the repo infers **`pdf_points`** vs **`normalized`** via **`inferBboxOverlayCoordMode`**; overlays must honor **`bboxCoordMode`** (see viewer).
- **Ignoring page number** — highlights are **1-based** and filtered per page in the viewer; mismatching page breaks row ↔ bbox sync.
- **Assuming confidence always exists** — type is **`number | null`**.
- **Reading IDP from `user_inputs` or merged top-level `outputs` for this feature** — the implemented parser reads **`state.completed.outputs`** only (`getOutputs`).
- **Parsing `dictionary.entries` incorrectly** — map keys must use **`entry.value`** keyed by key text, as documented in **`entryListToValueMap`** (see module comments and [`docs/idp-invoice-pdf-highlights.md`](docs/idp-invoice-pdf-highlights.md)).

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
| `npm run kognitos:read-output` | Print raw automation + run JSON from the Kognitos API (use `--run <id>` for one run); see [Automation run outputs](#automation-run-outputs-retrieve-for-insights) |
| `npm run kognitos:supplier-invoices` | List supplier invoice numbers parsed from stored run payloads (helper for audits) |
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
