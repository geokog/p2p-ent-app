# Payload Shapes & Fixture Matrix

This reference catalogs every payload-shape variant the reference
adapter is known to handle, with one minimal JSON fixture per variant
and the expected `FieldHighlight[]` output. Every adapter copy MUST
run all listed fixtures and assert the expected output before shipping.

The contract is in [./contract.md](./contract.md). The reference
adapter is in [./adapter.md](./adapter.md) (source:
[`../assets/idp-payload-adapter.ts`](../assets/idp-payload-adapter.ts)).

## How to use this reference

1. Pick a unit-test framework appropriate for your runtime (Jest,
   Vitest, Node `node:test`, etc.).
2. For each fixture below, construct the payload JSON, run it through
   `parseIdpInvoiceFieldHighlights` (or
   `parseIdpInvoiceFieldHighlightsWithTrace` for skip-reason
   coverage), and assert the output matches.
3. When Kognitos rolls a new variant in production, add a fixture
   here **before** updating the adapter — and file an upstream
   feedback entry so the next app to deploy has the variant covered.

## Source-of-truth notes

| Layer | Location |
| --- | --- |
| **Database** | `kognitos_runs.payload` (JSONB) — full GetRun/ListRuns-shaped document |
| **HTTP (browser)** | `GET /api/<vendor>/runs/{runId}/payload` → `{ payload: … }` |
| **HTTP (PDF bytes)** | A separate route that resolves the file id from run inputs and downloads via the Files API. See `kognitos-app-development/references/document-preview.md` → "Document Fetch and Payload Fetch." |

The payload route should select `payload` only and not reshape IDP
output. Anything the parser needs must already be inside the JSON.

## Variant index

| # | Variant | Why it matters |
| --- | --- | --- |
| 1 | Numbers as primitives | Sanity baseline |
| 2 | `{ number: N }` wrapper | Most common protobuf shape |
| 3 | `{ value: { number: N } }` nested wrapper | Real payloads stack at least one extra `value` layer |
| 4 | Decimal-bit, scale 0 | Integer-valued bbox via Decimal |
| 5 | Decimal-bit, scale 4 | Typical normalized fraction |
| 6 | Decimal-bit, scale 28 (max) | Boundary of the scale cap |
| 7 | Decimal-bit, negative sign | Sign-bit handling |
| 8 | Normalized bbox (`x + width ≤ 1`) | Coord-mode inference picks `"normalized"` |
| 9 | PDF-points bbox, Y-up (PDF user space) | `chooseYAxisFlipForPage` returns `"flip"` |
| 10 | PDF-points bbox, Y-down (viewport space) | `chooseYAxisFlipForPage` returns `"noflip"` |
| 11 | Mixed-page Y conventions in one payload | Per-page flip selection (the contract warns "do NOT assume a single global convention") |
| 12 | `element_type === "extracted_field"` | Legacy path |
| 13 | `element_type === "document_field"` | Current `book-idp` path |
| 14 | `idp_extraction_results` (snake_case) source key | Standard storage |
| 15 | `idpExtractionResults` (camelCase) source key | Some intermediate marshalers |
| 16 | `value.list.items` field-list path | Standard payload |
| 17 | `value.items` field-list path | Newer payloads |
| 18 | `dictionary.entries` root | Standard storage |
| 19 | Top-level `entries` array root | Some intermediate marshalers |
| 20 | Empty `fields` list | Adapter returns `[]`, no error |
| 21 | Missing `idp_extraction_results` entirely | Adapter returns `[]`, no error |
| 22 | Missing `state.completed.outputs` | Adapter returns `[]`, no error |
| 23 | Field with `name` in `NAME_BLOCKLIST` | Skipped, `skipReason` populated |
| 24 | Field with `name === ""` | Skipped, `skipReason: "missing name"` |
| 25 | Field with `name` containing `markdown_report` | Skipped, `skipReason: "name blocklisted or empty (...)"` |
| 26 | Field with `name === "summary"` | Skipped (prefix rule) |
| 27 | Field with `page_number` missing | Skipped, `skipReason: "invalid page_number (undefined)"` |
| 28 | Field with `page_number === 0` | Skipped, `skipReason: "invalid page_number (0)"` |
| 29 | Field with bbox `width: 0` | Skipped, `skipReason: "bounding_box missing or failed x/y/width/height validation"` |
| 30 | Field with `confidence === null` | Highlight emitted, `confidence: null` |
| 31 | Field with `confidence === 0.85` (fractional) | Highlight emitted, `confidence: 0.85` (raw) |
| 32 | Field with `confidence === 85` (percent-like) | Highlight emitted, `confidence: 85` (raw, NOT normalized) |
| 33 | Mixed `extracted_field` + `document_field` in one list | Both kept |
| 34 | Mixed valid + skipped fields | Valid kept, skipped traced |

The remainder of this document gives one minimal payload per variant
plus the expected output. Real payloads bundle many of these; the
adapter is composition-friendly.

## Fixture conventions

All fixtures use these helpers to keep the JSON readable. (Replicate
or factor them out in your test file.)

```ts
const struct = (entries: Array<{ key: string; value: unknown }>) => ({
  dictionary: {
    entries: entries.map((e) => ({
      key: { text: e.key },
      value: e.value,
    })),
  },
});

const num = (n: number) => ({ number: n });
const wrappedNum = (n: number) => ({ value: { number: n } });
const decimalNum = (
  lo: number,
  hi: number,
  mid = 0,
  flags = 0,
) => ({ lo, hi, mid, flags });

const bbox = (x: number, y: number, width: number, height: number) =>
  struct([
    { key: "x", value: num(x) },
    { key: "y", value: num(y) },
    { key: "width", value: num(width) },
    { key: "height", value: num(height) },
  ]);

const validField = (overrides: Record<string, unknown>) =>
  struct([
    { key: "element_type", value: "document_field" },
    { key: "name", value: "vendor_invoice_number" },
    {
      key: "values",
      value: { list: { items: [{ text: "INV-112233" }] } },
    },
    { key: "page_number", value: num(1) },
    { key: "confidence", value: num(0.92) },
    { key: "bounding_box", value: bbox(0.1, 0.1, 0.3, 0.05) },
    ...Object.entries(overrides).map(([k, v]) => ({ key: k, value: v })),
  ]);

const wrapPayload = (fields: unknown[]) => ({
  state: {
    completed: {
      outputs: {
        idp_extraction_results: struct([
          {
            key: "fields",
            value: { list: { items: fields } },
          },
        ]),
      },
    },
  },
});
```

## Worked fixtures (selected)

The variant index above lists 34 cases. The fixtures below are the
ones most likely to bite in production — the rest can be derived from
these patterns.

### F1 / F2 / F3 — number wrapping variants

```ts
// Variant 1: primitive
const f1 = wrapPayload([validField({ page_number: 2 })]);
// expected: 1 highlight, pageNumber === 2

// Variant 2: { number: N }
const f2 = wrapPayload([validField({ page_number: num(2) })]);
// expected: 1 highlight, pageNumber === 2

// Variant 3: { value: { number: N } }
const f3 = wrapPayload([validField({ page_number: wrappedNum(2) })]);
// expected: 1 highlight, pageNumber === 2
```

### F4–F7 — Decimal-bit variants

```ts
// Variant 4: Decimal scale 0 (integer-valued)
const f4 = wrapPayload([
  validField({
    bounding_box: struct([
      { key: "x", value: decimalNum(72, 0, 0, 0) },         // 72.0
      { key: "y", value: decimalNum(96, 0, 0, 0) },         // 96.0
      { key: "width", value: decimalNum(120, 0, 0, 0) },    // 120.0
      { key: "height", value: decimalNum(36, 0, 0, 0) },    // 36.0
    ]),
  }),
]);
// expected: 1 highlight, bbox = { x: 72, y: 96, width: 120, height: 36 },
//           bboxCoordMode === "pdf_points"

// Variant 5: Decimal scale 4 (typical normalized fraction)
//   flags = 4 << 16 = 0x40000
//   value = lo / 10^4
const f5 = wrapPayload([
  validField({
    bounding_box: struct([
      { key: "x", value: decimalNum(1000, 0, 0, 0x40000) },  // 0.1000
      { key: "y", value: decimalNum(1000, 0, 0, 0x40000) },  // 0.1000
      { key: "width", value: decimalNum(3000, 0, 0, 0x40000) }, // 0.3000
      { key: "height", value: decimalNum(500, 0, 0, 0x40000) }, // 0.0500
    ]),
  }),
]);
// expected: 1 highlight, bbox = { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
//           bboxCoordMode === "normalized"

// Variant 6: Decimal with encoded scale > 28; adapter caps at 28.
//   flags = 31 << 16 = 0x1F0000 → encoded scale 31 (max representable in
//   the 8 scale bits). Adapter clamps to 28 per `if (scale > 28) scale = 28`.
//   With lo = 85, expected magnitude = 85 / 10^28 ≈ 8.5e-27.
//
// NOTE: lo / mid / hi must each fit in uint32 (the C# `Decimal.GetBits`
// contract — adapter's `>>> 0` enforces this). For magnitudes that
// exceed 2^32, compose across mid (bits 32-63) and hi (bits 64-95):
//   total = hi * 2^64 + mid * 2^32 + lo
const f6 = wrapPayload([
  validField({
    confidence: decimalNum(85, 0, 0, 0x1F0000),
  }),
]);
// expected: 1 highlight, confidence ≈ 8.5e-27 (scale clamped to 28)

// Variant 7: Decimal negative sign (sign bit = 31)
const f7 = wrapPayload([
  validField({
    confidence: decimalNum(85, 0, 0, 0x80020000), // -85 / 10^2 = -0.85
  }),
]);
// expected: 1 highlight, confidence ≈ -0.85
//           (the adapter passes the value through; UI is responsible for clamping)
```

### F9 / F10 / F11 — Y-axis convention

`chooseYAxisFlipForPage` is run by the *viewer*, not by the adapter
itself, but the adapter's output must support the call. These
fixtures verify the bbox decoder produces bboxes in the right
coordinate system for downstream flip selection.

> **Selector tie-break behavior:** `chooseYAxisFlipForPage` uses a
> strict `>` comparison on overlap area and returns `"noflip"` on
> ties. For any bbox where both Y-up and Y-down interpretations land
> *fully inside* the page, both overlap areas are equal → tie →
> `"noflip"`. The selector only returns `"flip"` when one
> interpretation puts bboxes off-page (overlap = 0) while the other
> keeps them on. The fixtures below demonstrate the SHAPE of Y-up vs
> Y-down inputs; their selector outputs reflect this tie-break, not
> a per-fixture distinction.

```ts
// Variant 9: PDF-points, Y-up. y values are large (> page height when interpreted Y-down).
//   Page is letter-size: 612 x 792 (PDF points).
const f9 = wrapPayload([
  validField({
    page_number: num(1),
    bounding_box: bbox(72, 720, 120, 36), // top-left in Y-up = high y
  }),
]);
// expected: 1 highlight; bbox preserved exactly.
// chooseYAxisFlipForPage([f9.highlights[0]], { width: 612, height: 792 }) === "noflip"
//   (both interpretations land fully inside the page → tie → noflip)

// Variant 10: PDF-points, Y-down (viewport space).
const f10 = wrapPayload([
  validField({
    page_number: num(1),
    bounding_box: bbox(72, 36, 120, 36), // top-left in Y-down = low y
  }),
]);
// expected: 1 highlight; bbox preserved exactly.
// chooseYAxisFlipForPage([f10.highlights[0]], { width: 612, height: 792 }) === "noflip"

// Variant 11: Mixed conventions across pages in one payload.
const f11 = wrapPayload([
  validField({
    name: "field_a",
    page_number: num(1),
    bounding_box: bbox(72, 720, 120, 36),  // page 1: Y-up
  }),
  validField({
    name: "field_b",
    page_number: num(2),
    bounding_box: bbox(72, 36, 120, 36),   // page 2: Y-down
  }),
]);
// expected: 2 highlights.
// Per-page flip resolution must run independently for page 1 and page 2.
// With the doc's bbox values both pages return "noflip" (see tie-break
// note above). The structural property under test is that the selector
// is invoked per-page (no shared state) — not the specific outputs.
```

### F12 / F13 / F33 — element-type alias

```ts
// Variant 12: Legacy alias.
const f12 = wrapPayload([validField({ element_type: "extracted_field" })]);
// expected: 1 highlight.

// Variant 13: Current alias.
const f13 = wrapPayload([validField({ element_type: "document_field" })]);
// expected: 1 highlight.

// Variant 33: Mixed in one payload.
const f33 = wrapPayload([
  validField({ name: "a", element_type: "extracted_field" }),
  validField({ name: "b", element_type: "document_field" }),
]);
// expected: 2 highlights.
```

### F14 / F15 — root key casing

```ts
// Variant 15: camelCase source key.
const f15 = {
  state: {
    completed: {
      outputs: {
        idpExtractionResults: struct([
          { key: "fields", value: { list: { items: [validField({})] } } },
        ]),
      },
    },
  },
};
// expected: 1 highlight.
```

### F18 / F19 — root tree shape

```ts
// Variant 19: top-level entries array root.
const f19 = {
  state: {
    completed: {
      outputs: {
        idp_extraction_results: {
          entries: [
            {
              key: { text: "fields" },
              value: { list: { items: [validField({})] } },
            },
          ],
        },
      },
    },
  },
};
// expected: 1 highlight.
```

### F20 / F21 / F22 — empty / missing payloads (no throw)

```ts
const f20 = wrapPayload([]);                    // empty fields list
const f21 = { state: { completed: { outputs: {} } } };
const f22 = {};                                  // missing path entirely
// All three: parseIdpInvoiceFieldHighlights returns [] and does NOT throw.
```

### F23–F29 — skip-reason coverage

Each of these fixtures is intentionally invalid in exactly one way.
Use `parseIdpInvoiceFieldHighlightsWithTrace` to assert the right
`skipReason` string. Stable strings are part of the contract.

```ts
// Variant 23: blocklisted name.
const f23 = wrapPayload([validField({ name: "payment_recommendation" })]);
// expected: 0 highlights, traces[0].skipReason matches /name blocklisted/

// Variant 27: missing page_number.
const f27 = wrapPayload([validField({ page_number: undefined })]);
// expected: 0 highlights, traces[0].skipReason === "invalid page_number (undefined)"

// Variant 29: zero-width bbox.
const f29 = wrapPayload([
  validField({ bounding_box: bbox(0.1, 0.1, 0, 0.05) }),
]);
// expected: 0 highlights, traces[0].skipReason === "bounding_box missing or failed x/y/width/height validation"
```

### F30 / F31 / F32 — confidence pass-through

```ts
// Variant 30: null confidence.
const f30 = wrapPayload([validField({ confidence: undefined })]);
// expected: 1 highlight, confidence === null

// Variant 31: fractional 0–1.
const f31 = wrapPayload([validField({ confidence: num(0.92) })]);
// expected: 1 highlight, confidence === 0.92  (NOT normalized to 92)

// Variant 32: percent-like 0–100.
const f32 = wrapPayload([validField({ confidence: num(85) })]);
// expected: 1 highlight, confidence === 85    (NOT normalized to 0.85)
```

## Numeric encoding deep-dive

Kognitos serializes numbers as protobuf **Value** wrappers (`struct`,
`number`, nested `value`, etc.). Some coordinates appear as **C#
`Decimal`-style** JSON: `{ lo, hi, mid?, flags? }`. The reference
adapter decodes those with `decodeCSharpDecimalLoMidHiFlags` (96-bit
magnitude + scale in `flags`) — **not** `lo / 2^32`.

After decoding, `inferBboxOverlayCoordMode` decides whether
coordinates are normalized `[0, 1]` fractions vs PDF points relative
to the PDF.js base viewport.

## Contract drift

If Kognitos renames output keys or nests IDP elsewhere, update
`getOutputs`, `getIdpRoot`, and the `fields` / list resolution in the
reference adapter, then add a new fixture variant here for the new
shape. The diagnostics surface
([./diagnostics.md](./diagnostics.md)) is the fastest way to see
whether the expected branches still match production payloads.
