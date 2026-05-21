---
name: kognitos-idp-payload
description: Decode Kognitos IDP extraction payloads (`state.completed.outputs.idp_extraction_results`) into a flat, viewer-ready field list. Use when consuming IDP output for document preview, exception review, IDP fact editing, validation reports, or any UI that overlays bounding boxes on a source document.
license: MIT
---

# Kognitos IDP Payload

Use this skill when application code reads
`state.completed.outputs.idp_extraction_results` from a Kognitos run
and needs to turn that protobuf-shaped Struct into a flat
`FieldHighlight[]` for UI consumption.

The IDP payload is a free-form `Struct` — the OpenAPI spec does not
schematize its inner shape, so the application owns the contract
end-to-end. This skill ships:

- The contract the adapter must satisfy.
- A reference adapter you can copy into your app's adapter layer.
- A test-fixture matrix covering every known payload-shape variant.
- A diagnostics surface (debug env vars, parse-trace type, payload
  funnel report) so "why did this run produce zero highlights?" is
  answerable without instrumenting the parser by hand.

The companion skill `kognitos-app-development` references this skill
from its `document-preview.md` reference. If you are building a
document preview surface, start there for the UI / layout / overlay
contract; come here for the parser.

## Default Flow

1. Read [references/contract.md](references/contract.md) to confirm
   the payload shape your run actually emits is one of the supported
   shapes (or to file a feedback entry if it isn't).
2. Copy the reference adapter described in
   [references/adapter.md](references/adapter.md) into your app's
   adapter layer (typically `lib/<vendor>/idp-*.ts`). Adapt the
   import paths, but **do not** modify the parser internals — extend
   the alias sets and blocklists if you need to add a new
   `element_type` or skip a new aggregate key.
3. Use [references/payload-shapes.md](references/payload-shapes.md)
   to drive unit-test fixtures. Every adapter copy MUST run all
   listed fixtures and assert the expected output before shipping.
4. Wire the debug env vars and the diagnostics function from
   [references/diagnostics.md](references/diagnostics.md) into your
   server route + browser console *before* the first deploy — they
   are the only thing standing between you and a silent zero-highlight
   regression in production.

## When To Load More

- For the contract (paths, element types, number decoding, Y-axis
  convention, name blocklist):
  [references/contract.md](references/contract.md)
- For the reference adapter source and the helper-function inventory:
  [references/adapter.md](references/adapter.md)
- For the test-fixture matrix (one fixture per known payload-shape
  variant): [references/payload-shapes.md](references/payload-shapes.md)
- For debug env vars, the parse-trace type, the diagnostics endpoint,
  and the `skipReason` vocabulary:
  [references/diagnostics.md](references/diagnostics.md)

## Key Concepts

- **The adapter is the contract.** Every UI surface that consumes IDP
  output reads `FieldHighlight[]`, never the raw payload. If the UI
  walks a protobuf wrapper, the contract has been broken.
- **One adapter per app, not per surface.** Document preview,
  exception review, and fact-editing all consume the same flat field
  list. If a surface needs a different shape, project from
  `FieldHighlight[]` rather than re-parsing.
- **`element_type` aliases extend the helper, not the call sites.**
  When Kognitos adds a new alias (current: `extracted_field`,
  `document_field`), extend `EXTRACTED_FIELD_ELEMENT_TYPES` in
  exactly one place. Inlining the literal comparison is the most
  common cause of silent zero-highlight regressions.
- **Numbers are not always primitives.** Bbox axes, page numbers, and
  confidence values arrive as primitives, as protobuf `Value`
  wrappers (`{ number: N }`, nested `{ value: { number: N } }`), or
  as C# `Decimal`-style bits (`{ lo, hi, mid?, flags? }`). The
  reference adapter handles all three; do not write a `parseFloat`
  shortcut.
- **Bbox Y-axis is not universal.** PDF user space is bottom-left
  origin (Y up); IDP can also emit boxes in viewport/image space
  (top-left origin, Y down). Decide flip-vs-no-flip *per page* by
  scoring overlap with the page rectangle. The same payload can mix
  conventions across pages.
- **Diagnostics are not optional.** The four-step funnel
  (`payloadIsObject` → `hasIdpExtractionResults` →
  `fieldsListItemsLength` → `extractedFieldItemsCount` →
  `normalizedHighlightsCount`) tells you *which* layer of the
  contract a given run is failing. Without it, "no highlights" is
  indistinguishable from "no PDF" from "API broken."

## Notes

- The reference adapter is intentionally framework-agnostic. It depends
  only on `BigInt` (for the Decimal decoder) and standard `Map` /
  `Array`. Drop it into Node, Next.js (server or client), or any
  TypeScript runtime.
- Keep the adapter source in your app under your own SCM. The plugin
  ships a *reference*, not a runtime — if the upstream parser changes
  in a way that affects your app, the change rolls in via plugin
  update, but you must re-copy the adapter into your repo to pick it
  up. (A future version of this skill may graduate the reference into
  a published `@kognitos/idp-payload-adapter` npm package; until then,
  copy-and-fork is the contract.)
- Do **not** import from this skill at runtime (`@kognitos/...`
  imports do not resolve to plugin paths). Treat the reference adapter
  as source you maintain.
