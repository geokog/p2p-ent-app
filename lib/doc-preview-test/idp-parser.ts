/**
 * Self-contained parser for the document-preview-test bed.
 *
 * Walks `payload.state.completed.outputs.idp_extraction_results` and emits a
 * flat `FieldHighlight[]` keyed for the viewer. Per the skill, the viewer
 * consumes this flat shape and never re-walks protobuf wrappers.
 *
 * Element-type aliasing lives here in a single helper
 * (`isExtractedFieldElementType`); call sites must use it rather than
 * inlining the literal so a new alias is a one-line change.
 *
 * The bbox node is decoded with the same struct unwrapper used for field
 * values — `{x, y, width, height}` may each be a primitive, a `Value`
 * wrapper, or a Decimal-bit object.
 */

import {
  decodeIdpValue,
  entriesToValueMap,
  readDictEntries,
  readListItems,
  readStructNumber,
  readStructText,
  unwrapValueLayers,
  type StructEntry,
} from "./idp-decode";

export type Bbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BboxCoordMode = "normalized" | "pdf_points";

export type FieldHighlight = {
  /** Stable id (`{name}-{page}-{index}`) used by `data-field-*-id` and React keys. */
  id: string;
  /** Technical key from the IDP payload (e.g. `vendor_invoice_number`). */
  name: string;
  /** Humanized UI label (Title Case). */
  displayName: string;
  /** 1-based page number from the payload. */
  pageNumber: number;
  /** Confidence as the payload reported it — UI normalizes to 0–100. */
  confidence: number | null;
  /** Element type literal as decoded from the payload (lowercased). */
  elementType: string;
  bbox: Bbox;
  bboxCoordMode: BboxCoordMode;
  /**
   * Raw IDP value (post-`decodeIdpValue` plain object/array/primitive). The
   * value chip recurses through this; never `JSON.stringify` it.
   */
  rawValue: unknown;
};

/**
 * Centralized element-type alias check. New aliases extend the set; call
 * sites must use this helper.
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

/**
 * Skip aggregate / report keys that are emitted in the IDP fields list but
 * are not extracted document fields (the panel rendering them just adds
 * noise).
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

function shouldSkipFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (NAME_BLOCKLIST.has(n)) return true;
  if (n.includes("markdown_report")) return true;
  if (n === "summary" || n.startsWith("summary_")) return true;
  return false;
}

function getOutputs(payload: Record<string, unknown>): Record<string, unknown> | null {
  const state = payload.state as Record<string, unknown> | undefined;
  const completed = state?.completed as Record<string, unknown> | undefined;
  const outputs = completed?.outputs as Record<string, unknown> | undefined;
  return outputs ?? null;
}

/** Decode a `bounding_box` node into a flat `{x,y,width,height}`. */
function parseBoundingBox(value: unknown): Bbox | null {
  const entries = readDictEntries(value);
  if (!Array.isArray(entries)) return null;
  const m = entriesToValueMap(entries);
  const x = readStructNumber(m.get("x"));
  const y = readStructNumber(m.get("y"));
  const width = readStructNumber(m.get("width"));
  const height = readStructNumber(m.get("height"));
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

/**
 * Infer per-field bbox coordinate mode. Magnitudes ≤ 1.0005 are treated as
 * normalized 0–1 fractions; anything larger is PDF user-space points
 * relative to the PDF.js base viewport at scale 1.
 */
export function inferBboxCoordMode(b: Bbox): BboxCoordMode {
  const max = Math.max(b.x + b.width, b.y + b.height, b.x, b.y, b.width, b.height);
  return max <= 1.0005 ? "normalized" : "pdf_points";
}

/** Walk the `name` value, which IDP can serialize either as text or as a list. */
function readFieldName(value: unknown): string | null {
  const direct = readStructText(value);
  if (direct) return direct;
  const items = readListItems(value);
  if (items && items.length > 0) {
    const first = readStructText(items[0]);
    if (first) return first;
  }
  return null;
}

function parseFieldRow(
  item: unknown,
  index: number,
): FieldHighlight | null {
  const entries = readDictEntries(item);
  if (!Array.isArray(entries)) return null;
  const m = entriesToValueMap(entries);

  const elementTypeRaw =
    readStructText(m.get("element_type")) ??
    readStructText(m.get("elementType"));
  if (!isExtractedFieldElementType(elementTypeRaw)) return null;

  const name = readFieldName(m.get("name"));
  if (!name || shouldSkipFieldName(name)) return null;

  const pageNumber = readStructNumber(m.get("page_number") ?? m.get("pageNumber"));
  if (pageNumber == null || !Number.isFinite(pageNumber) || pageNumber < 1) {
    return null;
  }

  const bbox = parseBoundingBox(m.get("bounding_box") ?? m.get("boundingBox"));
  if (!bbox) return null;

  const confidence = readStructNumber(m.get("confidence"));
  const rawValuesNode = m.get("values");

  // The `values` field on a row is a list of value objects. Decode the
  // first item — that is what the chip renders.
  let rawValue: unknown = null;
  const valueItems = readListItems(rawValuesNode);
  if (valueItems && valueItems.length > 0) {
    rawValue = decodeIdpValue(valueItems[0]);
  } else {
    rawValue = decodeIdpValue(rawValuesNode);
  }

  return {
    id: `${name}-${Math.floor(pageNumber)}-${index}`,
    name,
    displayName: name, // formatted by the UI via humanizeFieldName
    pageNumber: Math.floor(pageNumber),
    confidence:
      confidence != null && Number.isFinite(confidence) ? confidence : null,
    elementType: (elementTypeRaw ?? "").toLowerCase(),
    bbox,
    bboxCoordMode: inferBboxCoordMode(bbox),
    rawValue,
  };
}

/**
 * Walk the IDP root and resolve the `fields` list. Tolerates both the
 * `{ dictionary: { entries } }` shape and a flat `{ entries }` shape, and
 * the `value.list.items` / `list.items` / `items` value-side variants.
 */
function readFieldsListItems(idpRoot: unknown): unknown[] {
  const entries = readDictEntries(idpRoot);
  if (!Array.isArray(entries)) return [];
  let fieldsValue: unknown = null;
  for (const row of entries) {
    if (!row || typeof row !== "object") continue;
    const r = row as StructEntry;
    if (readStructText(r.key) === "fields") {
      fieldsValue = r.value;
      break;
    }
  }
  if (fieldsValue == null) return [];
  const items = readListItems(fieldsValue);
  return items ?? [];
}

/** Diagnostic counts mirroring the skill's logging contract. */
export type ParserDiagnostics = {
  payloadIsObject: boolean;
  hasIdpExtractionResults: boolean;
  fieldsListItemsLength: number;
  extractedFieldItemsCount: number;
  normalizedHighlightsCount: number;
};

export function parseFieldHighlights(
  payload: unknown,
): { highlights: FieldHighlight[]; diagnostics: ParserDiagnostics } {
  const empty: ParserDiagnostics = {
    payloadIsObject: false,
    hasIdpExtractionResults: false,
    fieldsListItemsLength: 0,
    extractedFieldItemsCount: 0,
    normalizedHighlightsCount: 0,
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { highlights: [], diagnostics: empty };
  }

  const outputs = getOutputs(payload as Record<string, unknown>);
  if (!outputs) {
    return {
      highlights: [],
      diagnostics: { ...empty, payloadIsObject: true },
    };
  }

  const idpRoot =
    unwrapValueLayers(outputs.idp_extraction_results ?? outputs.idpExtractionResults);
  const hasIdpExtractionResults =
    idpRoot != null && typeof idpRoot === "object" && !Array.isArray(idpRoot);
  if (!hasIdpExtractionResults) {
    return {
      highlights: [],
      diagnostics: { ...empty, payloadIsObject: true },
    };
  }

  const items = readFieldsListItems(idpRoot);
  let extractedFieldItemsCount = 0;
  const highlights: FieldHighlight[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entries = readDictEntries(item);
    const m = entriesToValueMap(entries);
    const elType =
      readStructText(m.get("element_type")) ??
      readStructText(m.get("elementType"));
    if (isExtractedFieldElementType(elType)) {
      extractedFieldItemsCount += 1;
    }
    const h = parseFieldRow(item, i);
    if (h) highlights.push(h);
  }

  return {
    highlights,
    diagnostics: {
      payloadIsObject: true,
      hasIdpExtractionResults: true,
      fieldsListItemsLength: items.length,
      extractedFieldItemsCount,
      normalizedHighlightsCount: highlights.length,
    },
  };
}

/**
 * Per-page Y-axis flip decision for non-normalized bboxes.
 *
 * IDP can emit either PDF user space (origin bottom-left, Y up) or
 * viewport/image space (origin top-left, Y down) — and the same payload
 * can mix conventions across pages. We score each candidate by how much
 * the union of `fieldsOnPage` overlaps the page rectangle and pick the
 * winning convention.
 */
export function chooseYAxisFlipForPage(
  fieldsOnPage: Array<{ bbox: Bbox }>,
  pageRect: { width: number; height: number },
): "flip" | "noflip" {
  function overlap(flip: boolean): number {
    let area = 0;
    for (const f of fieldsOnPage) {
      const y = flip
        ? pageRect.height - f.bbox.y - f.bbox.height
        : f.bbox.y;
      const ix =
        Math.max(0, Math.min(pageRect.width, f.bbox.x + f.bbox.width)) -
        Math.max(0, Math.min(pageRect.width, f.bbox.x));
      const iy =
        Math.max(0, Math.min(pageRect.height, y + f.bbox.height)) -
        Math.max(0, Math.min(pageRect.height, y));
      if (ix > 0 && iy > 0) area += ix * iy;
    }
    return area;
  }
  return overlap(true) > overlap(false) ? "flip" : "noflip";
}
