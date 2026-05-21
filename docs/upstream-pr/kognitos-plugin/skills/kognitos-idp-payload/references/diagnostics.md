# Diagnostics

How to know *which* layer of the IDP contract is failing when a run
shows zero highlights — without instrumenting the parser by hand.

The contract is in [./contract.md](./contract.md). The reference
adapter is in [./adapter.md](./adapter.md). The fixtures are in
[./payload-shapes.md](./payload-shapes.md).

## Why this exists

"This run shows no highlights" can mean any of:

- The PDF didn't load.
- The payload route returned an error.
- The payload route returned a payload with no IDP output.
- The payload had IDP output, but `fields` was empty.
- `fields` had items, but no item matched the `element_type` alias.
- Items matched the alias, but every one of them was filtered (name
  blocklist, missing page number, invalid bbox).

These six cases require six different fixes. Without diagnostics they
all surface as the same empty overlay and the operator has nothing to
act on.

## The four-step funnel

The diagnostics surface reduces every "no highlights" report to one of
four states:

```
payloadIsObject         (false → payload route is broken or missing)
hasIdpExtractionResults (false → run has no IDP output)
fieldsListItemsLength   (0     → run has IDP output but no field list)
extractedFieldItemsCount(0     → field list has items but none match the alias)
normalizedHighlightsCount (0   → items matched alias but every one was filtered)
```

The diagnostics function ships in the reference adapter
(`getIdpHighlightPayloadDiagnostics`) and is the primary signal log.

```ts
export type IdpHighlightPayloadDiagnostics = {
  /** True when `row.payload` is a non-null object (the JSON column value). */
  payloadIsObject: boolean;
  /** `payload.state.completed.outputs.idp_extraction_results` is present. */
  hasIdpExtractionResults: boolean;
  /** `fields.value.list.items` length (0 if path missing). */
  fieldsListItemsLength: number;
  /** Items in that list with `element_type === extracted_field`/`document_field`. */
  extractedFieldItemsCount: number;
  /** Highlights returned by `parseIdpInvoiceFieldHighlights(payload)`. */
  normalizedHighlightsCount: number;
};
```

The reference function lives at the bottom of the contract section in
[./contract.md](./contract.md); copy it from the adapter source if
your runtime needs it (it's not exported by the asset by default
because it duplicates work the trace API already does — see "Trace
API" below).

## Wire it from the payload route

Every payload-fetch endpoint should log a one-line diagnostic. The
plugin recommends a single, structured log line per fetch:

```ts
// app/api/<vendor>/runs/[id]/payload/route.ts (Next.js example)

import { getIdpHighlightPayloadDiagnostics } from "@/lib/<vendor>/idp-diagnostics";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  const row = await db.kognitosRuns.findUnique({ where: { runId } });
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const diag = getIdpHighlightPayloadDiagnostics(row.payload);
  console.log("[kognitos_runs payload GET]", JSON.stringify({ runId, ...diag }));
  return Response.json({ payload: row.payload });
}
```

Pick a stable log prefix (e.g. `[kognitos_runs payload GET]`) so
ops can grep across runs.

## Trace API (richer, per-field)

For a deeper look at *why* specific fields were dropped, the reference
adapter ships `parseIdpInvoiceFieldHighlightsWithTrace`:

```ts
const { highlights, traces } = parseIdpInvoiceFieldHighlightsWithTrace(payload);
for (const trace of traces) {
  if (!trace.finalOk) {
    console.log("[idp-field-skip]", JSON.stringify(trace));
  }
}
```

Each `IdpFieldParseTrace` carries:

| Field | What it tells you |
| --- | --- |
| `fieldIndex` | Position in the source `fields.list.items` array |
| `parsedMapKeys` | The keys the adapter found in the row's Struct (sanity check that the row shape matches the contract) |
| `elementType` | What the row claimed to be — useful when a new alias is rolling out |
| `name` | The (possibly blocklisted) field name |
| `pageNumber` | The (possibly invalid) decoded page number |
| `confidence` | The raw confidence value |
| `boundingBoxPresent` | Whether a `bounding_box` entry was found at all |
| `bboxMapKeys` | The keys the adapter found in the bbox Struct (e.g. some payloads emit `Width` instead of `width`) |
| `decodedBBox` | The four numbers after running through the number walker (any `undefined` here pinpoints which axis decoder failed) |
| `rawBBoxNodes` | The raw axis values *before* decoding — feed this back into a unit test to reproduce the failure |
| `finalOk` | `true` if the field produced a `FieldHighlight`, `false` otherwise |
| `skipReason` | Stable, grep-able string explaining the skip |

## skipReason vocabulary

The `skipReason` strings are part of the contract — they are stable so
ops dashboards can chart their distribution. The adapter currently
emits these:

| `skipReason` (regex) | Cause | Fix |
| --- | --- | --- |
| `/^element_type is not extracted_field\/document_field/` | Row is some other element type (legend, header, paragraph) | Expected for non-field rows; investigate only if EVERY row triggers this |
| `/^missing name$/` | Field has no `name` key | Upstream extraction bug; file a Kognitos ticket with the run id |
| `/^name blocklisted or empty/` | Field name is in `NAME_BLOCKLIST` or matches a blocklist pattern (`markdown_report`, `summary_*`) | Expected for aggregate keys |
| `/^invalid page_number/` | Page number is missing, non-finite, or `< 1` | Upstream extraction bug; file a Kognitos ticket |
| `/^bounding_box missing or failed x\/y\/width\/height validation$/` | Bbox couldn't be decoded or has zero/negative width/height | Inspect `rawBBoxNodes` in the trace — most often a Decimal-bit decoder mismatch |

If you add a new skip reason in your fork (because your app needs an
additional validation), use the same `:`-delimited format and document
it in your app's adapter README. New shared skip reasons should also
be filed as upstream feedback so the vocabulary stays consistent
across apps.

## Debug env vars

The reference adapter is silent at runtime. Two opt-in env vars turn
on per-field debug logging when investigating a specific run:

| Env var | Where | Effect |
| --- | --- | --- |
| `IDP_HIGHLIGHT_FIELD_DEBUG=1` | **Server** (API route, scripts, SSR) | Logs `[idp-field-parse]` per field with the full `IdpFieldParseTrace` |
| `NEXT_PUBLIC_IDP_BBOX_LOG=1` | **Client** (browser) | Extra bbox decode logging in the viewer |

Pick framework-appropriate names if your runtime isn't Next.js
(`process.env.IDP_HIGHLIGHT_FIELD_DEBUG` works in any Node-compatible
runtime; `NEXT_PUBLIC_*` is a Next.js convention for vars exposed to
the browser bundle).

The reference adapter does **not** ship the env-var read code (so it
stays runtime-agnostic). Wrap the trace API in your app's adapter
layer:

```ts
// lib/<vendor>/idp-payload-adapter-with-debug.ts
import {
  parseIdpInvoiceFieldHighlights,
  parseIdpInvoiceFieldHighlightsWithTrace,
  type FieldHighlight,
} from "./idp-payload-adapter";

function idpFieldDebugEnabled(): boolean {
  return process.env.IDP_HIGHLIGHT_FIELD_DEBUG === "1";
}

export function parseHighlights(
  payload: Record<string, unknown>,
): FieldHighlight[] {
  if (!idpFieldDebugEnabled()) {
    return parseIdpInvoiceFieldHighlights(payload);
  }
  const { highlights, traces } = parseIdpInvoiceFieldHighlightsWithTrace(payload);
  for (const trace of traces) {
    console.log(
      "[idp-field-parse]",
      JSON.stringify(trace, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
  }
  return highlights;
}
```

The `bigint` replacer above is necessary because the trace's
`rawBBoxNodes` field carries the raw Decimal-bit objects, which are
plain numbers here but may carry through `BigInt`s if your runtime
picked up a different upstream marshaler.

## Operator-facing health checks

For dashboards or admin pages that need to surface IDP health without
parsing every run, expose `getIdpHighlightPayloadDiagnostics` directly
through an admin endpoint:

```ts
// app/api/admin/idp-health/[runId]/route.ts (example)
export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const row = await db.kognitosRuns.findUnique({ where: { runId } });
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    runId,
    ...getIdpHighlightPayloadDiagnostics(row.payload),
  });
}
```

This is the fastest answer to "is the contract still matching stored
JSON for this run?" without sending the full payload to a UI.

## Cross-cutting log prefix conventions

To keep ops grep-able across apps that consume this skill, prefer
these stable prefixes:

| Prefix | Source | Purpose |
| --- | --- | --- |
| `[kognitos_runs payload GET]` | Server payload route | One-line diagnostic per fetch |
| `[idp-field-parse]` | Server, trace mode | Per-field trace when `IDP_HIGHLIGHT_FIELD_DEBUG=1` |
| `[idp-field-skip]` | Server, trace mode (skips only) | Subset of above, surface only failed fields |
| `[idp-bbox]` | Browser, when `NEXT_PUBLIC_IDP_BBOX_LOG=1` | Per-bbox decoded axis values + chosen `bboxCoordMode` |

Prefixes are case-sensitive and bracket-delimited so log scrapers can
match exactly.
