# IDP Payload Contract

This is the tool-agnostic specification for what an adapter **must**
accept when consuming `state.completed.outputs.idp_extraction_results`
on a Kognitos run. Every rule below is in response to a real failure
mode that a previous implementation hit and a downstream consumer
noticed.

The reference adapter in [./adapter.md](./adapter.md) implements every
rule. The fixture matrix in [./payload-shapes.md](./payload-shapes.md)
exercises every rule. If you write a parser that disagrees with this
contract, the next payload variant will silently drop fields.

## Source Path

The IDP root lives at one of:

```
payload.state.completed.outputs.idp_extraction_results
payload.state.completed.outputs.idpExtractionResults
```

Accept both. (snake_case is the on-disk shape; camelCase appears in
some intermediate JSON marshalers.)

If neither path resolves to an object, return `[]` — do **not** throw.
A run with no IDP output is a valid input; the diagnostics surface
(see [./diagnostics.md](./diagnostics.md)) is responsible for
reporting why.

## Tree Shape

The root is a protobuf `Struct`. It is **either**:

```jsonc
{ "dictionary": { "entries": [ { "key": …, "value": … }, … ] } }
```

or a top-level `entries` array of the same `{ key, value }` row shape.
Treat both as equivalent; resolve the row list and proceed.

Each `{ key, value }` row's `key` is itself a Struct that must be
decoded down to its `text` leaf — see "Number / Text Decoding" below.

## Fields List

Under the root entries, find the entry whose key text is `"fields"`.
The value holds a list. Resolve the items via this fallback chain:

1. `value.list.items`
2. `value.items` (newer payloads)

(`value.list` may be wrapped in additional `{ value: … }` layers; the
adapter's recursive unwrapper handles those.)

If `fields` is missing or not list-shaped, return `[]`.

## Field Row Shape

Each list item is again `{ dictionary: { entries } }`. Decode the
entries to a `Map<keyText, value>` and read these keys:

| Map key | Type | Used for |
| --- | --- | --- |
| `element_type` / `elementType` | text | Filter — only `extracted_field` / `document_field` rows are kept |
| `name` | text (may be nested under a `dictionary` with a `text` key) | Field label / row id |
| `values` | list | First item's text → `value` (display value) |
| `page_number` / `pageNumber` | number | 1-based page index |
| `confidence` | number (0–1 fractional, OR 0–100, depending on the run) | Confidence meter |
| `bounding_box` / `boundingBox` | nested dictionary with `x` / `y` / `width` / `height` keys | Overlay geometry |

Skip the row if **any** of:

- `element_type` is missing or fails the alias check (next section).
- `name` is missing, blocklisted, or matches one of the aggregate-key
  patterns (see "Name Blocklist" below).
- `page_number` is missing, non-finite, or `< 1`.
- `bounding_box` is missing or any of its components fails to decode.

Each skip MUST be recorded in the parse trace (see
[./diagnostics.md](./diagnostics.md)) with a `skipReason` string. "No
highlights" without `skipReason` data is undebuggable.

## Element Type Aliases

Kognitos has shipped two element-type literals over time:

| Literal | Era |
| --- | --- |
| `extracted_field` | Legacy `book-idp-v1` output |
| `document_field` | Current `book-idp` output (Bumblebee `normalizeDocumentField`) |

Compare case-insensitively. Use a single `isExtractedFieldElementType`
helper that wraps a `Set` — never inline the literal comparison. New
aliases extend the helper, **not** the call sites.

```ts
const EXTRACTED_FIELD_ELEMENT_TYPES = new Set([
  "extracted_field",
  "document_field",
]);

export function isExtractedFieldElementType(
  elementType: string | null | undefined,
): boolean {
  if (!elementType) return false;
  return EXTRACTED_FIELD_ELEMENT_TYPES.has(elementType.trim().toLowerCase());
}
```

Inlining the comparison is the most common cause of silent
zero-highlight regressions when Kognitos rolls a new alias.

## Number / Text Decoding

Numbers and text strings inside an IDP payload arrive in three shapes:

1. **Primitive.** `42`, `"INV-112233"`. Use directly.
2. **Protobuf `Value` wrapper.** `{ "number": 42 }`,
   `{ "text": "INV-112233" }`, often with one or more `{ "value": … }`
   layers around them.
3. **C# `Decimal`-bit object.**
   `{ "lo": <u32>, "hi": <u32>, "mid"?: <u32>, "flags"?: <i32> }`.
   This is `System.Decimal.GetBits()` output emitted by the Kognitos
   runtime when extraction produces fixed-point values.

The reference adapter uses one recursive walker per leaf type
(`readTextFromValueMapEntry`, `readNumberFromValueMapEntry`) with a
depth cap (10) that protects against pathological self-referencing
wrappers.

### `Decimal`-bit decoding

The `Decimal` shape is decoded as `Decimal.GetBits`:

- 96-bit unsigned magnitude composed of `lo | (mid << 32) | (hi << 64)`.
- `flags` carries scale (bits 16–23, capped at 28) and sign (bit 31).
- Result: `sign * magnitude / 10^scale`, coerced to `number`.

Reference decoder:

```ts
function decodeCSharpDecimalLoMidHiFlags(o: Record<string, unknown>): number | undefined {
  if (typeof o.lo !== "number" || typeof o.hi !== "number") return undefined;
  const ulo = BigInt((o.lo as number) >>> 0);
  const umid = BigInt((typeof o.mid === "number" ? (o.mid as number) : 0) >>> 0);
  const uhi = BigInt((o.hi as number) >>> 0);
  const flags = typeof o.flags === "number" ? o.flags : 0;
  let scale = (flags >>> 16) & 0xff;
  if (scale > 28) scale = 28;
  const sign = (flags & 0x8000_0000) !== 0 ? BigInt(-1) : BigInt(1);
  const mag = (uhi << BigInt(64)) | (umid << BigInt(32)) | ulo;
  const signed = sign * mag;
  const n = Number(signed) / Math.pow(10, scale);
  return Number.isFinite(n) ? n : undefined;
}
```

**Do not** use `lo / 2^32` as a shortcut. Earlier adapters did this and
produced wrong bbox fractions on real payloads — the decoded values
*looked* like normalized 0–1 fractions but were actually rounded
multiples of `2^-32`. Bbox overlays drew at the wrong position with no
visible error.

## Bounding Box Decoding

Each bbox is itself a `{ dictionary: { entries } }` with keys
`x`, `y`, `width`, `height`. Each component is decoded through the
**same** number walker as field values — it can be a primitive, a
protobuf `Value` wrapper, or a `Decimal`-bit object.

After decoding all four components, validate:

- All four are finite numbers.
- `width > 0` and `height > 0`.

A bbox that fails validation should be a row-level skip (with
`skipReason: "bounding_box missing or failed x/y/width/height validation"`),
not a global throw.

### Coordinate mode inference

After decoding, infer how the viewer should interpret the numbers:

```ts
export function inferBboxOverlayCoordMode(b: {
  x: number; y: number; width: number; height: number;
}): "normalized" | "pdf_points" {
  const maxCorner = Math.max(b.x + b.width, b.y + b.height);
  const maxDim = Math.max(b.x, b.y, b.width, b.height, maxCorner);
  if (maxDim <= 1.0005) return "normalized";
  return "pdf_points";
}
```

The `1.0005` upper bound (rather than `1`) tolerates floating-point
slop in normalized fractions that crossed the wire.

| Mode | Interpretation |
| --- | --- |
| `normalized` | `x`, `y`, `width`, `height` are 0–1 fractions of the page rectangle. The viewer multiplies by `pageWidth` / `pageHeight` to get CSS pixels. |
| `pdf_points` | Numbers are PDF user-space points relative to the PDF.js base viewport at `scale: 1`. The viewer divides by `baseW` / `baseH` to get a fraction, then by `cssW` / `cssH` to get pixels. |

Both modes resolve into the same percentage-positioned overlay
downstream — the viewer does not need a separate render path per mode.

### Y-axis convention

For non-normalized bboxes, the Y-axis origin is **not** universal:

- PDF user space is bottom-left origin (Y up).
- IDP can also emit boxes in viewport/image space (top-left origin,
  Y down).

Decide flip-vs-no-flip **per page** by scoring how much each candidate
placement of `fieldsOnPage` overlaps the page rectangle, then picking
the winning convention for that page. Do NOT assume a single global
convention — the same payload can mix conventions across pages.

```ts
export function chooseYAxisFlipForPage(
  fieldsOnPage: Array<{ bbox: { x: number; y: number; width: number; height: number } }>,
  pageRect: { width: number; height: number },
): "flip" | "noflip" {
  function overlap(flip: boolean): number {
    let area = 0;
    for (const f of fieldsOnPage) {
      const y = flip ? pageRect.height - f.bbox.y - f.bbox.height : f.bbox.y;
      const ix =
        Math.max(0, Math.min(pageRect.width, f.bbox.x + f.bbox.width)) -
        Math.max(0, f.bbox.x);
      const iy =
        Math.max(0, Math.min(pageRect.height, y + f.bbox.height)) -
        Math.max(0, y);
      area += Math.max(0, ix) * Math.max(0, iy);
    }
    return area;
  }
  return overlap(true) > overlap(false) ? "flip" : "noflip";
}
```

Run this against all `fieldsOnPage` for the active page once per page
mount; cache the result; apply it to every bbox on that page.
Normalized bboxes skip the flip check entirely (they are already
top-left).

## Confidence

Confidence values arrive as either:

- A fractional number `[0, 1]` (most common in current outputs).
- A 0–100 integer (some legacy outputs).

The adapter MUST surface the raw number unchanged. UI formatters
(see "Display Helpers" in [./adapter.md](./adapter.md)) are responsible
for normalizing into a percent string.

`null` is a valid value (the run lacked a confidence score for the
field). Do **not** substitute `0` — the UI uses `null` to render an
"unknown" state.

## Name Blocklist

Skip any row whose name matches the blocklist. These are aggregate
keys emitted alongside the field list, not actual extracted fields,
and they pollute the right panel if rendered.

| Pattern | Examples |
| --- | --- |
| Exact match (case-insensitive) | `payment_recommendation`, `result_type`, `document_count`, `document`, `page_count`, `confidence`, `""` (empty string) |
| Substring | name contains `markdown_report` |
| Prefix | name is exactly `summary` or starts with `summary_` |

Reference helper:

```ts
const NAME_BLOCKLIST = new Set(
  [
    "payment_recommendation",
    "result_type",
    "document_count",
    "document",
    "page_count",
    "confidence",
    "",
  ].map((s) => s.toLowerCase()),
);

export function shouldSkipFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (NAME_BLOCKLIST.has(n)) return true;
  if (n.includes("markdown_report")) return true;
  if (n === "summary" || n.startsWith("summary_")) return true;
  return false;
}
```

If your app needs to extend the blocklist (for example, a
domain-specific aggregate key), extend `NAME_BLOCKLIST` in your fork
of the adapter — do NOT inline the comparison at call sites.

## Output Shape

The adapter returns `FieldHighlight[]`:

```ts
export type FieldHighlight = {
  /** Synthetic, stable id derived from name + page + index. Unique within a run. */
  id: string;
  /** 1-based page number. */
  pageNumber: number;
  /** Technical field name (snake_case). UI renders this in the row's mono label. */
  label: string;
  /** First list-item text from `values`. Empty string if the value is missing. */
  value: string;
  /** Raw confidence (fractional 0–1 OR 0–100, see "Confidence" above). null = unknown. */
  confidence: number | null;
  /** Decoded bbox. Coordinate interpretation depends on `bboxCoordMode` below. */
  bbox: { x: number; y: number; width: number; height: number };
  /** Source document filename (used by tooltips and row metadata). */
  documentName: string;
  /** How the viewer should interpret `bbox` numbers — see "Coordinate mode inference" above. */
  bboxCoordMode: "normalized" | "pdf_points";
};
```

The shape is intentionally flat. The viewer never walks back into the
raw payload for any UI need; if a surface needs additional metadata
(extraction model id, alternate value candidates, fact-edit
provenance), project it from a parallel field on `FieldHighlight`,
**not** by re-parsing the payload.
