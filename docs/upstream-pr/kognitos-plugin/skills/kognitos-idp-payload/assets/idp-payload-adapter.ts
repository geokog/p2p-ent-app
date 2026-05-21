/**
 * Reference adapter for Kognitos IDP extraction payloads.
 *
 * Drop this file into your application's adapter layer (typically
 * `lib/<vendor>/idp-payload-adapter.ts`) and adapt the import paths.
 * The contract this implements is in `references/contract.md`. The
 * fixtures every copy of this file MUST pass before shipping are in
 * `references/payload-shapes.md`.
 *
 * Framework-agnostic: depends only on `BigInt` (for the Decimal
 * decoder) and standard `Map` / `Array`. Drop into Node, Next.js
 * (server or client), or any TypeScript runtime.
 *
 * Do NOT modify the parser internals when consuming the reference.
 * Extend the alias `Set`s and `NAME_BLOCKLIST` if your app needs to
 * recognize a new `element_type` or skip a new aggregate key. Inlining
 * literal comparisons at call sites is the most common cause of
 * silent zero-highlight regressions when Kognitos rolls a new alias.
 */

// =====================================================================
// Public types
// =====================================================================

export type FieldHighlight = {
  /** Synthetic, stable id derived from name + page + index. Unique within a run. */
  id: string;
  /** 1-based page number from payload. */
  pageNumber: number;
  /** Technical field name (snake_case). UI renders this in the row's mono label. */
  label: string;
  /** First list-item text from `values`. Empty string if the value is missing. */
  value: string;
  /** Raw confidence (fractional 0–1 OR 0–100). null = unknown. */
  confidence: number | null;
  /** Decoded bbox. Coordinate interpretation depends on `bboxCoordMode`. */
  bbox: { x: number; y: number; width: number; height: number };
  /** Source document filename (used by tooltips and row metadata). */
  documentName: string;
  /** How the viewer should interpret `bbox` numbers. */
  bboxCoordMode: "normalized" | "pdf_points";
};

/** One entry in the per-field parse trace. Used by diagnostics. */
export type IdpFieldParseTrace = {
  fieldIndex: number;
  rawEntries: unknown;
  parsedMapKeys: string[];
  elementType: string | undefined;
  name: string | undefined;
  valuesText: string | undefined;
  pageNumber: number | undefined;
  confidence: number | undefined;
  boundingBoxPresent: boolean;
  bboxMapKeys: string[];
  rawBBoxNodes: Record<string, unknown>;
  decodedBBox: { x?: number; y?: number; width?: number; height?: number };
  finalOk: boolean;
  skipReason: string | null;
};

// =====================================================================
// Element-type alias set + helper
// =====================================================================

/**
 * Element types that represent a single IDP "extracted field" with a
 * value, page number, bounding box, and confidence. Kognitos' current
 * `book-idp` output tags these as `document_field`; the older
 * `extracted_field` literal is kept for backward compatibility with
 * previously stored payloads. Both normalize to the same
 * `FieldHighlight` shape downstream. Bumblebee's
 * `normalizeDocumentField` is the upstream canonical mapping.
 */
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

// =====================================================================
// Name blocklist + helper
// =====================================================================

/**
 * Aggregate keys that are emitted alongside the field list but are not
 * actual extracted fields. Skip these or they pollute the right panel.
 * Extend the Set in your fork if your app needs to skip more.
 */
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

// =====================================================================
// Recursive value walkers (text + number) with depth caps
// =====================================================================

/**
 * Walks optional `value` wrappers so both raw `Struct` nodes and
 * mapped values work. Capped at depth 10 to defend against pathological
 * self-referencing wrappers.
 */
function unwrapProtoValueLayers(val: unknown): unknown {
  let cur: unknown = val;
  for (let depth = 0; depth < 10; depth++) {
    if (cur == null) return cur;
    if (typeof cur !== "object" || Array.isArray(cur)) return cur;
    const o = cur as Record<string, unknown>;
    if (o.value != null && typeof o.value === "object") {
      cur = o.value;
      continue;
    }
    return cur;
  }
  return cur;
}

function isLongNumberShape(o: Record<string, unknown>): boolean {
  return typeof o.lo === "number" && typeof o.hi === "number";
}

/**
 * Decodes Kognitos / protobuf JSON `{ lo, hi, mid?, flags? }` as
 * **System.Decimal**-style bits (same layout as C#
 * `Decimal.GetBits`): 96-bit unsigned magnitude (lo, mid, hi) and
 * `flags` with scale in bits 16–23 (capped at 28) and sign in bit 31.
 *
 * This matches IDP bbox normalized fractions (~0.05–0.9). The old
 * `lo / 2^32` shortcut is incorrect for these payloads — earlier
 * adapters that used it produced bbox positions that *looked*
 * correct but were rounded to multiples of 2^-32 and drew at the
 * wrong place with no visible error.
 */
function decodeCSharpDecimalLoMidHiFlags(
  o: Record<string, unknown>,
): number | undefined {
  if (!isLongNumberShape(o)) return undefined;
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

function readTextFromValueMapEntry(val: unknown): string | undefined {
  let cur: unknown = val;
  for (let depth = 0; depth < 10; depth++) {
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    const o = cur as Record<string, unknown>;
    if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
    if (o.stringValue != null && String(o.stringValue).trim()) {
      return String(o.stringValue).trim();
    }
    if (o.string_value != null && String(o.string_value).trim()) {
      return String(o.string_value).trim();
    }
    if (o.value != null && typeof o.value === "object") {
      cur = o.value;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function readNumberFromValueMapEntry(val: unknown): number | undefined {
  let cur: unknown = val;
  for (let depth = 0; depth < 10; depth++) {
    if (cur == null) return undefined;
    if (typeof cur === "number" && Number.isFinite(cur)) return cur;
    if (typeof cur === "string") {
      const n = parseFloat(cur);
      return Number.isFinite(n) ? n : undefined;
    }
    if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
    const o = cur as Record<string, unknown>;

    if (isLongNumberShape(o)) {
      return decodeCSharpDecimalLoMidHiFlags(o);
    }

    if (typeof o.number === "number" && Number.isFinite(o.number)) {
      return o.number;
    }
    if (typeof o.number === "string") {
      const n = parseFloat(o.number);
      if (Number.isFinite(n)) return n;
    }
    const numObj = o.number;
    if (numObj && typeof numObj === "object" && !Array.isArray(numObj)) {
      const rec = numObj as Record<string, unknown>;
      const decoded = isLongNumberShape(rec)
        ? decodeCSharpDecimalLoMidHiFlags(rec)
        : undefined;
      if (decoded != null) return decoded;
    }

    if (o.value != null && typeof o.value === "object") {
      cur = o.value;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function readKeyText(node: unknown): string | undefined {
  return readTextFromValueMapEntry(node);
}

// =====================================================================
// Map / list accessors over `dictionary.entries`
// =====================================================================

/**
 * Map `dictionary.entries` to `key.text` → `entry.value`
 * (protobuf-JSON row shape). Used wherever the adapter needs to read
 * named keys out of a Struct.
 */
export function entryListToValueMap(entries: unknown): Map<string, unknown> {
  const m = new Map<string, unknown>();
  if (!Array.isArray(entries)) return m;
  for (const row of entries) {
    const r = row as Record<string, unknown>;
    const keyText = readKeyText(r.key);
    if (keyText) m.set(keyText, r.value);
  }
  return m;
}

/** Direct lookup variant for when you only need one key. */
function protoMapGet(entries: unknown, keyText: string): unknown {
  if (!Array.isArray(entries)) return undefined;
  for (const row of entries) {
    const r = row as Record<string, unknown>;
    const kt = readKeyText(r.key);
    if (kt === keyText) return r.value;
  }
  return undefined;
}

function readFirstListItemTextFromEntry(val: unknown): string | undefined {
  const leaf = unwrapProtoValueLayers(val);
  if (!leaf || typeof leaf !== "object" || Array.isArray(leaf)) return undefined;
  const o = leaf as Record<string, unknown>;
  const list = (o.list as Record<string, unknown> | undefined)?.items ?? o.items;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const first = list[0];
  return (
    readTextFromValueMapEntry(first) ??
    readNameFromMappedValue(first)
  );
}

function readNameFromMappedValue(val: unknown): string | undefined {
  const direct = readTextFromValueMapEntry(val);
  if (direct) return direct;
  const leaf = unwrapProtoValueLayers(val);
  if (!leaf || typeof leaf !== "object" || Array.isArray(leaf)) return undefined;
  const dict = (leaf as Record<string, unknown>).dictionary as
    | Record<string, unknown>
    | undefined;
  if (!dict?.entries) return undefined;
  const m = entryListToValueMap(dict.entries);
  return readTextFromValueMapEntry(m.get("text"));
}

// =====================================================================
// Bounding box decoding
// =====================================================================

function parseBoundingBox(value: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const leaf = unwrapProtoValueLayers(value);
  const v = leaf as Record<string, unknown> | undefined;
  if (!v) return null;
  const dict = v.dictionary as Record<string, unknown> | undefined;
  const entries = dict?.entries;
  const m = entryListToValueMap(entries);
  const x = readNumberFromValueMapEntry(m.get("x"));
  const y = readNumberFromValueMapEntry(m.get("y"));
  const width = readNumberFromValueMapEntry(m.get("width"));
  const height = readNumberFromValueMapEntry(m.get("height"));
  if (
    x == null ||
    y == null ||
    width == null ||
    height == null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** How the overlay should interpret decoded bbox numbers. */
export function inferBboxOverlayCoordMode(b: {
  x: number;
  y: number;
  width: number;
  height: number;
}): "normalized" | "pdf_points" {
  const maxCorner = Math.max(b.x + b.width, b.y + b.height);
  const maxDim = Math.max(b.x, b.y, b.width, b.height, maxCorner);
  if (maxDim <= 1.0005) return "normalized";
  return "pdf_points";
}

/**
 * Decide flip-vs-no-flip per page by scoring overlap with the page
 * rectangle. The same payload can mix Y-axis conventions across
 * pages, so this MUST run per page.
 */
export function chooseYAxisFlipForPage(
  fieldsOnPage: Array<{
    bbox: { x: number; y: number; width: number; height: number };
  }>,
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

// =====================================================================
// Payload navigation helpers
// =====================================================================

function getOutputs(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const state = payload.state as Record<string, unknown> | undefined;
  const completed = state?.completed as Record<string, unknown> | undefined;
  const outputs = completed?.outputs as Record<string, unknown> | undefined;
  return outputs ?? null;
}

function getIdpRoot(outputs: Record<string, unknown>): unknown {
  return outputs.idp_extraction_results ?? outputs.idpExtractionResults;
}

/**
 * Extract the document filename from the run inputs. The reference
 * implementation reads `user_inputs.invoice.file.remote`; adapt the
 * key path to match your app's own input shape.
 */
export function extractInvoiceDocumentFileLabel(
  payload: Record<string, unknown>,
): string {
  const roots = [payload.userInputs, payload.user_inputs];
  for (const root of roots) {
    if (!root || typeof root !== "object" || Array.isArray(root)) continue;
    const inv = (root as Record<string, unknown>).invoice;
    if (!inv || typeof inv !== "object" || Array.isArray(inv)) continue;
    const file = (inv as Record<string, unknown>).file as
      | Record<string, unknown>
      | undefined;
    const remote = file?.remote;
    if (typeof remote === "string" && remote.trim()) {
      const parts = remote.trim().split("/");
      const last = parts[parts.length - 1]?.trim();
      if (last) return last;
    }
  }
  return "invoice.pdf";
}

// =====================================================================
// Per-field parser (with trace) + main entry point
// =====================================================================

function parseOneFieldItemWithTrace(
  item: unknown,
  documentName: string,
  index: number,
): { highlight: FieldHighlight | null; trace: IdpFieldParseTrace } {
  const o = item as Record<string, unknown> | undefined;
  const dict = o?.dictionary as Record<string, unknown> | undefined;
  const entries = dict?.entries;
  const m = entryListToValueMap(entries);
  const parsedMapKeys = [...m.keys()];

  const rawBBoxNodes: Record<string, unknown> = {};
  const bboxVal = m.get("bounding_box") ?? m.get("boundingBox");
  const bboxLeaf = unwrapProtoValueLayers(bboxVal) as
    | Record<string, unknown>
    | undefined;
  const bboxDict = bboxLeaf?.dictionary as Record<string, unknown> | undefined;
  const bboxEntries = bboxDict?.entries;
  const bboxMap = entryListToValueMap(bboxEntries);
  for (const k of ["x", "y", "width", "height"]) {
    rawBBoxNodes[k] = bboxMap.get(k) as unknown;
  }

  const elementType =
    readTextFromValueMapEntry(m.get("element_type")) ??
    readTextFromValueMapEntry(m.get("elementType"));
  const name = readNameFromMappedValue(m.get("name"));
  const valuesText = readFirstListItemTextFromEntry(m.get("values"));
  const pageNumber = readNumberFromValueMapEntry(
    m.get("page_number") ?? m.get("pageNumber"),
  );
  const confidence = readNumberFromValueMapEntry(m.get("confidence"));

  const decodedBBox: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } = {
    x: readNumberFromValueMapEntry(bboxMap.get("x")),
    y: readNumberFromValueMapEntry(bboxMap.get("y")),
    width: readNumberFromValueMapEntry(bboxMap.get("width")),
    height: readNumberFromValueMapEntry(bboxMap.get("height")),
  };

  let skipReason: string | null = null;
  if (!isExtractedFieldElementType(elementType)) {
    skipReason = `element_type is not extracted_field/document_field (got ${elementType ?? "undefined"})`;
  } else if (!name || shouldSkipFieldName(name)) {
    skipReason = !name
      ? "missing name"
      : `name blocklisted or empty (${name})`;
  } else if (
    pageNumber == null ||
    !Number.isFinite(pageNumber) ||
    pageNumber < 1
  ) {
    skipReason = `invalid page_number (${String(pageNumber)})`;
  } else {
    const bbox = parseBoundingBox(bboxVal);
    if (!bbox) {
      skipReason =
        "bounding_box missing or failed x/y/width/height validation";
    } else {
      const conf =
        confidence != null && Number.isFinite(confidence) ? confidence : null;
      const bboxCoordMode = inferBboxOverlayCoordMode(bbox);
      const highlight: FieldHighlight = {
        id: `${name}-${Math.floor(pageNumber)}-${index}`,
        pageNumber: Math.floor(pageNumber),
        label: name,
        value: valuesText ?? "",
        confidence: conf,
        bbox,
        documentName,
        bboxCoordMode,
      };
      return {
        highlight,
        trace: {
          fieldIndex: index,
          rawEntries: entries,
          parsedMapKeys,
          elementType,
          name,
          valuesText,
          pageNumber,
          confidence,
          boundingBoxPresent: bboxVal != null,
          bboxMapKeys: [...bboxMap.keys()],
          rawBBoxNodes,
          decodedBBox,
          finalOk: true,
          skipReason: null,
        },
      };
    }
  }

  return {
    highlight: null,
    trace: {
      fieldIndex: index,
      rawEntries: entries,
      parsedMapKeys,
      elementType,
      name,
      valuesText,
      pageNumber,
      confidence,
      boundingBoxPresent: bboxVal != null,
      bboxMapKeys: [...bboxMap.keys()],
      rawBBoxNodes,
      decodedBBox,
      finalOk: false,
      skipReason,
    },
  };
}

/**
 * Main entry point. Accepts the raw payload object (the same shape
 * `kognitos_runs.payload` stores). Returns a flat `FieldHighlight[]`
 * suitable for direct UI consumption.
 *
 * Returns `[]` (never throws) for any of:
 *   - payload missing or non-object
 *   - `state.completed.outputs.idp_extraction_results` missing
 *   - `fields` entry missing or not list-shaped
 */
export function parseIdpInvoiceFieldHighlights(
  payload: Record<string, unknown>,
): FieldHighlight[] {
  const documentName = extractInvoiceDocumentFileLabel(payload);
  const outputs = getOutputs(payload);
  if (!outputs) return [];

  const idp = getIdpRoot(outputs);
  if (!idp || typeof idp !== "object" || Array.isArray(idp)) return [];

  const idpRec = idp as Record<string, unknown>;
  const topEntries =
    (idpRec.dictionary as Record<string, unknown> | undefined)?.entries ??
    idpRec.entries;
  const fieldsValue = protoMapGet(topEntries, "fields");
  if (fieldsValue == null) return [];

  const fv = fieldsValue as Record<string, unknown>;
  const list = fv.list as Record<string, unknown> | undefined;
  const items = list?.items ?? fv.items;
  if (!Array.isArray(items)) return [];

  const out: FieldHighlight[] = [];
  for (let i = 0; i < items.length; i++) {
    const { highlight } = parseOneFieldItemWithTrace(
      items[i],
      documentName,
      i,
    );
    if (highlight) out.push(highlight);
  }
  return out;
}

/**
 * Same as `parseIdpInvoiceFieldHighlights` but returns the per-field
 * trace alongside the surviving highlights. Use this when you need
 * to surface `skipReason` data through a diagnostics endpoint or
 * debug log. See `references/diagnostics.md`.
 */
export function parseIdpInvoiceFieldHighlightsWithTrace(
  payload: Record<string, unknown>,
): { highlights: FieldHighlight[]; traces: IdpFieldParseTrace[] } {
  const documentName = extractInvoiceDocumentFileLabel(payload);
  const outputs = getOutputs(payload);
  if (!outputs) return { highlights: [], traces: [] };

  const idp = getIdpRoot(outputs);
  if (!idp || typeof idp !== "object" || Array.isArray(idp)) {
    return { highlights: [], traces: [] };
  }

  const idpRec = idp as Record<string, unknown>;
  const topEntries =
    (idpRec.dictionary as Record<string, unknown> | undefined)?.entries ??
    idpRec.entries;
  const fieldsValue = protoMapGet(topEntries, "fields");
  if (fieldsValue == null) return { highlights: [], traces: [] };

  const fv = fieldsValue as Record<string, unknown>;
  const list = fv.list as Record<string, unknown> | undefined;
  const items = list?.items ?? fv.items;
  if (!Array.isArray(items)) return { highlights: [], traces: [] };

  const highlights: FieldHighlight[] = [];
  const traces: IdpFieldParseTrace[] = [];
  for (let i = 0; i < items.length; i++) {
    const { highlight, trace } = parseOneFieldItemWithTrace(
      items[i],
      documentName,
      i,
    );
    traces.push(trace);
    if (highlight) highlights.push(highlight);
  }
  return { highlights, traces };
}

// =====================================================================
// Display helpers (UI-facing)
// =====================================================================

/**
 * Confidence formatter for tooltips. Accepts the raw `FieldHighlight.confidence`
 * (fractional 0–1 OR 0–100, OR null) and returns a display string.
 */
export function formatConfidenceForTooltip(c: number | null): string {
  if (c == null || !Number.isFinite(c)) return "—";
  if (c > 0 && c <= 1) return String(Math.round(c * 100));
  return String(Math.round(c));
}

export function formatHighlightTooltip(h: FieldHighlight): string {
  const conf = formatConfidenceForTooltip(h.confidence);
  return [
    h.label,
    `Value: ${h.value || "—"}`,
    `Confidence: ${conf}`,
    `Document: ${h.documentName}`,
    `Page: ${h.pageNumber}`,
  ].join("\n");
}
