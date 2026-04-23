# IDP invoice field highlights (PDF bounding boxes)

This document records **where** field labels, values, confidence, page numbers, and bounding boxes come from in stored Kognitos runs, and **how** to reuse that parsing on another page.

## Source of truth

| Layer | Location |
|--------|----------|
| **Database** | `kognitos_runs.payload` (JSONB) — full GetRun/ListRuns-shaped document |
| **HTTP (browser)** | `GET /api/kognitos/runs/{runId}/payload` → `{ payload: … }` ([`app/api/kognitos/runs/[id]/payload/route.ts`](../app/api/kognitos/runs/[id]/payload/route.ts)) |
| **HTTP (PDF bytes)** | `GET /api/kognitos/runs/{runId}/invoice-pdf` — resolved from the same run row ([`app/api/kognitos/runs/[id]/invoice-pdf/route.ts`](../app/api/kognitos/runs/[id]/invoice-pdf/route.ts)) |

The payload route only selects `payload`; it does not reshape IDP output. Anything the parser needs must already be inside that JSON.

## JSON path (IDP extraction results)

Highlights are **not** read from `GET /api/kognitos/runs/[id]` (mapped `KognitosRun`). They are parsed from the **raw** payload:

1. `payload.state.completed.outputs` — completed automation outputs object.
2. Under outputs, IDP root is **either** key:
   - `idp_extraction_results`, **or**
   - `idpExtractionResults` (camelCase variant).
3. That node is a protobuf-style **Struct**: either `{ dictionary: { entries: [ { key, value }, … ] } }` or a top-level `entries` array with the same row shape.
4. From those entries, locate the **`fields`** entry (map key text `"fields"`). Its value holds a **list** of field objects:
   - Prefer `value.list.items`,
   - else `list.items`,
   - else `items` on the value object.
5. Each list **item** is again `{ dictionary: { entries } }`. Parser keeps rows where **`element_type`** (or `elementType`) text is **`extracted_field`** (case-insensitive).

Per-field data is read from each item’s `entries` map (via [`entryListToValueMap`](../lib/kognitos/idp-invoice-field-highlights.ts)):

| Map key (concept) | Typical protobuf key strings | Used for |
|-------------------|------------------------------|----------|
| Field name / label | `name`, etc. | Tooltip label |
| Extracted value | `values` (first list item text), nested maps | Display value |
| Page | `page_number` / `pageNumber` | 1-based page index |
| Confidence | `confidence` | Tooltip (0–1 or percent-like) |
| Bounding box | `bounding_box` / `boundingBox` | `x`, `y`, `width`, `height` in nested `dictionary.entries` |

Bounding box axes are decoded with the same numeric reader as other fields (see below).

## Numeric encoding (important for bboxes)

Kognitos often serializes numbers as protobuf **Value** wrappers (`struct`, `number`, nested `value`, etc.). Some coordinates appear as **C# `Decimal`-style** JSON: `{ lo, hi, mid?, flags? }`. The parser decodes those with `decodeCSharpDecimalLoMidHiFlags` (96-bit magnitude + scale in `flags`) — **not** `lo / 2^32`.

After decoding, [`inferBboxOverlayCoordMode`](../lib/kognitos/idp-invoice-field-highlights.ts) decides whether coordinates are **normalized** `[0,1]` fractions vs **PDF points** relative to the PDF.js base viewport.

## Code map (single module + consumers)

| Piece | File |
|-------|------|
| **Parse + diagnostics** | [`lib/kognitos/idp-invoice-field-highlights.ts`](../lib/kognitos/idp-invoice-field-highlights.ts) — `parseIdpInvoiceFieldHighlights`, `getIdpHighlightPayloadDiagnostics`, `entryListToValueMap`, `inferBboxOverlayCoordMode`, `formatHighlightTooltip` |
| **Payload API + server logs** | [`app/api/kognitos/runs/[id]/payload/route.ts`](../app/api/kognitos/runs/[id]/payload/route.ts) — logs `[kognitos_runs payload GET]` with diagnostic counts |
| **PDF + overlays UI** | [`components/kognitos/invoice-pdf-highlight-viewer.tsx`](../components/kognitos/invoice-pdf-highlight-viewer.tsx) — fetches payload client-side, parses, renders PDF.js + mask + boxes |
| **Current page embedding** | [`app/(dashboard)/expert-queue/page.tsx`](../app/(dashboard)/expert-queue/page.tsx) — invoice dialog |

## Reuse on another page

1. **Fetch** the raw payload: `fetch(\`/api/kognitos/runs/${runId}/payload\`)` then `res.json()` and use the `payload` object (must be a plain object, not an array).
2. **Parse**: `parseIdpInvoiceFieldHighlights(payload as Record<string, unknown>)` → `IdPdfFieldHighlight[]`.
3. **Optional**: `getIdpHighlightPayloadDiagnostics(payload)` for quick health checks (counts, path presence) without fully parsing every field trace.
4. **Render**: either reuse `InvoicePdfHighlightViewer` with `pdfUrl` + `runId`, or copy the overlay approach (SVG luminance mask + dim div + transparent hit targets) using `bbox` + `bboxCoordMode` and PDF.js viewport matching [`PdfPageWithHighlights`](../components/kognitos/invoice-pdf-highlight-viewer.tsx).

If you only need structured fields **without** PDF UI, importing `parseIdpInvoiceFieldHighlights` is enough.

## Debugging

| Env var | Where | Effect |
|---------|--------|--------|
| `IDP_HIGHLIGHT_FIELD_DEBUG=1` | **Server** (API route, scripts, SSR) | Logs `[idp-field-parse]` per field with [`IdpFieldParseTrace`](../lib/kognitos/idp-invoice-field-highlights.ts) when parsing runs |
| `NEXT_PUBLIC_IDP_BBOX_LOG=1` | **Client** | Extra bbox decode logging in the browser (if enabled in the viewer build) |

The payload `GET` handler always logs a one-line summary: `hasIdpExtractionResults`, `fieldsListItemsLength`, `extractedFieldItemsCount`, `normalizedHighlightsCount`.

## Contract drift

If Kognitos renames output keys or nests IDP elsewhere, update **`getOutputs`**, **`getIdpRoot`**, and the **`fields`** / list resolution in [`idp-invoice-field-highlights.ts`](../lib/kognitos/idp-invoice-field-highlights.ts). **`getIdpHighlightPayloadDiagnostics`** is the fastest way to see whether the expected branches still match stored JSON.
