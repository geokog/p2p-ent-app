# Reference Adapter

This reference describes the adapter that turns a raw Kognitos IDP
payload into a flat `FieldHighlight[]`. The full TypeScript source
ships in [`../assets/idp-payload-adapter.ts`](../assets/idp-payload-adapter.ts).

The contract the adapter implements is in [./contract.md](./contract.md).
The fixtures every copy of this adapter MUST pass before shipping are
in [./payload-shapes.md](./payload-shapes.md). The diagnostics surface
that wraps the adapter at runtime is in [./diagnostics.md](./diagnostics.md).

## How to use

1. **Copy** [`../assets/idp-payload-adapter.ts`](../assets/idp-payload-adapter.ts)
   into your application, typically at
   `lib/<vendor>/idp-payload-adapter.ts` (or wherever your adapter
   layer lives — see `kognitos-app-development/references/architecture.md`).
2. **Adapt the import paths.** The reference has none, but if you need
   to share types or helpers with other adapters in your repo, do that
   at the import boundary — do not modify the parser internals.
3. **Adapt `extractInvoiceDocumentFileLabel`** to read your app's own
   input shape. The reference reads
   `user_inputs.invoice.file.remote`, which is specific to invoice
   automations; if your app processes IDs, contracts, or other
   document types, point this helper at the relevant input key path.
4. **Run every fixture in [./payload-shapes.md](./payload-shapes.md)**
   as a unit test against your adapter copy before shipping. Every
   fixture must produce its expected output. If a fixture fails on a
   variant your app actually emits, file an upstream feedback entry
   *before* working around it.
5. **Wire diagnostics** as described in [./diagnostics.md](./diagnostics.md).
   The adapter ships `parseIdpInvoiceFieldHighlightsWithTrace` for
   exactly this purpose.

## What's in the adapter

The adapter file is organized as one section per layer of the
contract. Section headers are preserved in the source for grep-ability.

### Public types

- `FieldHighlight` — the canonical viewer-facing field shape. The UI
  consumes `FieldHighlight[]`, never the raw payload.
- `IdpFieldParseTrace` — one entry per parsed field. Reports
  `skipReason` for any field the adapter dropped, plus the raw bbox
  nodes and decoded values for that row. This is the type the
  diagnostics surface reads.

### Element-type alias set + helper

- `EXTRACTED_FIELD_ELEMENT_TYPES` (`Set<string>`) — currently
  `extracted_field` (legacy) and `document_field` (current `book-idp`).
- `isExtractedFieldElementType(elementType)` — case-insensitive,
  null-safe predicate. **Always** call this; never inline the literal
  comparison.

When Kognitos rolls a new alias, extend the `Set` (one place) and
re-publish. Inlining the comparison at call sites is the most common
cause of silent zero-highlight regressions.

### Name blocklist + helper

- `NAME_BLOCKLIST` (`Set<string>`) — exact-match aggregate keys to
  skip (e.g. `payment_recommendation`, `result_type`,
  `document_count`, `page_count`, `confidence`, the empty string).
- `shouldSkipFieldName(name)` — predicate that combines the exact-match
  set with the substring (`markdown_report`) and prefix
  (`summary` / `summary_*`) rules.

### Recursive value walkers (text + number) with depth caps

- `unwrapProtoValueLayers(val)` — walks optional `value` wrappers so
  both raw `Struct` nodes and mapped values work. Capped at depth 10.
- `readTextFromValueMapEntry(val)` — recursive text extractor that
  handles `text`, `stringValue`, `string_value`, and nested `value`
  layers.
- `readNumberFromValueMapEntry(val)` — recursive number extractor that
  handles primitives, `{ number: N }` wrappers, nested `{ value: … }`
  layers, and Decimal-bit objects.
- `decodeCSharpDecimalLoMidHiFlags(o)` — the `Decimal.GetBits`
  decoder. Returns `undefined` if the object isn't a Decimal-bit
  shape; callers chain it into the number walker. **Do not** use the
  `lo / 2^32` shortcut — earlier adapters that did produced bbox
  positions that *looked* correct but were rounded to multiples of
  `2^-32` and drew at the wrong place with no visible error.

The depth cap (10) is defensive. Real payloads never nest more than
2–3 layers, but the cap protects against pathological self-referencing
wrappers from upstream marshaler bugs.

### Map / list accessors over `dictionary.entries`

- `entryListToValueMap(entries)` — flattens
  `[{ key, value }, …]` rows into a `Map<keyText, value>`. Used
  wherever the adapter reads named keys out of a Struct.
- `protoMapGet(entries, keyText)` — direct one-shot lookup variant.
  Used to find the `fields` entry under the IDP root.
- `readFirstListItemTextFromEntry(val)` — extracts the first list
  item's text from a `values` entry (handles both `value.list.items`
  and `value.items` payload shapes).
- `readNameFromMappedValue(val)` — extracts a field name, including
  the case where `name` is itself a `{ dictionary: { entries: [{ key:
  "text", value: … }] } }` Struct.

### Bounding box decoding

- `parseBoundingBox(value)` — decodes the bbox dictionary, validates
  all four components are finite and `width > 0` / `height > 0`, and
  returns either `{ x, y, width, height }` or `null` (signaling a
  row-level skip).
- `inferBboxOverlayCoordMode(b)` — returns `"normalized"` if
  `max(x + width, y + height) ≤ 1.0005`, else `"pdf_points"`. The
  `1.0005` upper bound tolerates floating-point slop in normalized
  fractions that crossed the wire.
- `chooseYAxisFlipForPage(fieldsOnPage, pageRect)` — per-page flip
  selector. Run once per page mount; cache the result; apply to every
  bbox on that page. The same payload can mix conventions across
  pages, so a single global flip flag is wrong.

### Payload navigation helpers

- `getOutputs(payload)` — resolves
  `payload.state.completed.outputs` or returns `null`.
- `getIdpRoot(outputs)` — resolves
  `outputs.idp_extraction_results` or
  `outputs.idpExtractionResults` (snake_case OR camelCase variant).
- `extractInvoiceDocumentFileLabel(payload)` — extracts the document
  filename from the run inputs. **Adapt this to your app's input
  shape.**

### Per-field parser + main entry points

- `parseOneFieldItemWithTrace(item, documentName, index)` — parses a
  single field item, returns `{ highlight, trace }`. The trace
  includes a `skipReason` string for any field the parser dropped, so
  diagnostics can answer "why didn't this row produce a highlight."
- `parseIdpInvoiceFieldHighlights(payload)` — main entry point. Walks
  the path-fallback chain, runs every field through
  `parseOneFieldItemWithTrace`, returns the surviving highlights.
  Returns `[]` (never throws) for missing payloads.
- `parseIdpInvoiceFieldHighlightsWithTrace(payload)` — same, but
  returns `{ highlights, traces }` so callers can surface the
  per-field traces. Use this from your diagnostics endpoint.

### Display helpers (UI-facing)

- `formatConfidenceForTooltip(c)` — accepts the raw confidence value
  (fractional 0–1 OR 0–100 OR null) and returns a display string. The
  viewer's tooltip and confidence-meter aria-label both use this.
- `formatHighlightTooltip(h)` — multi-line tooltip composer for a
  single field. Used by overlay buttons that want a structured
  hover-card.

## What you must not change

The following are contract surface, not implementation details. If you
modify them in your adapter copy, you have broken the contract:

- The `FieldHighlight` shape. UI surfaces depend on the exact field
  list. If you need additional fields, add them as new optional keys
  — do not rename or remove existing keys.
- The depth cap on the recursive walkers. The cap is what prevents
  pathological inputs from infinite-looping.
- The `Decimal.GetBits` math. Bbox positions silently move if the
  decoder is wrong.
- The `1.0005` slop tolerance in `inferBboxOverlayCoordMode`. Tighter
  bounds reject real normalized payloads; looser bounds misclassify
  small `pdf_points` payloads.
- The skip-reason strings emitted by `parseOneFieldItemWithTrace`.
  Diagnostics endpoints depend on stable strings for log-grep
  workflows.

## What you may change

- `EXTRACTED_FIELD_ELEMENT_TYPES` — extend when Kognitos rolls a new
  alias. (Also file a feedback entry so the upstream reference can
  add the same alias for everyone.)
- `NAME_BLOCKLIST` — extend when your app emits a new aggregate key.
- `extractInvoiceDocumentFileLabel` — rewrite for your app's input
  shape.
- The `id` synthesis pattern (`${name}-${page}-${index}`) — if you
  need a different id scheme (UUID, hash, content-derived), swap it
  here. Just make sure ids are stable across renders for the same
  payload.

## Versioning notes

The reference adapter is intentionally framework-agnostic. There is no
runtime dependency on this skill — copies in apps are forks. When the
upstream reference changes (new variant, new alias), the change rolls
in via plugin update, but you must re-copy the adapter into your app
to pick it up.

A future version of this skill may graduate the reference into a
published `@kognitos/idp-payload-adapter` npm package. Until then,
copy-and-fork is the contract.
