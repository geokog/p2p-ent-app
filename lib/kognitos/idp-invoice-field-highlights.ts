/**
 * Parses Kognitos IDP extraction output under
 * `state.completed.outputs.idp_extraction_results` for overlay highlights on invoice PDFs.
 *
 * `dictionary.entries` rows are `{ key, value }`. Field maps must use **entry.value**
 * (not the whole entry) keyed by `readKeyText(entry.key)`.
 *
 * **Documentation:** JSON paths, protobuf quirks, reuse steps, and debug env vars are
 * described in `docs/idp-invoice-pdf-highlights.md` (keep in sync when changing parsers).
 */

export type IdPdfFieldHighlight = {
  id: string;
  /** 1-based page number from payload */
  pageNumber: number;
  label: string;
  value: string;
  confidence: number | null;
  bbox: { x: number; y: number; width: number; height: number };
  documentName: string;
  /**
   * How the viewer should position the overlay: normalized [0,1] fractions of the page,
   * or PDF user-space units (points) vs the PDF.js base viewport.
   */
  bboxCoordMode: "normalized" | "pdf_points";
};

/** Set `IDP_HIGHLIGHT_FIELD_DEBUG=1` to log per-field parse traces (server or scripts). */
function idpFieldDebugEnabled(): boolean {
  return process.env.IDP_HIGHLIGHT_FIELD_DEBUG === "1";
}

/** Client: set `NEXT_PUBLIC_IDP_BBOX_LOG=1` to log decoded bbox axes per field (browser console). */
function idpBboxLogEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IDP_BBOX_LOG === "1";
}

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

/** Map `dictionary.entries` to `key.text` → `entry.value` (protobuf-JSON row shape). */
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

function readKeyText(node: unknown): string | undefined {
  return readTextFromValueMapEntry(node);
}

/**
 * Walks optional `value` wrappers so both raw `Struct` nodes and mapped values work.
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

function isLongNumberShape(o: Record<string, unknown>): boolean {
  return typeof o.lo === "number" && typeof o.hi === "number";
}

/**
 * Decodes Kognitos / protobuf JSON `{ lo, hi, mid?, flags? }` as **System.Decimal**-style
 * bits (same layout as C# `Decimal.GetBits`): 96-bit unsigned magnitude (lo, mid, hi) and
 * `flags` with scale in bits 16–23 (0–28) and sign in bit 31. This matches IDP bbox
 * normalized fractions (~0.05–0.9); the old `lo / 2^32` shortcut was incorrect for these payloads.
 */
function decodeCSharpDecimalLoMidHiFlags(o: Record<string, unknown>): number | undefined {
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

/** How overlay should interpret decoded bbox numbers. */
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

function protoMapGet(entries: unknown, keyText: string): unknown {
  if (!Array.isArray(entries)) return undefined;
  for (const row of entries) {
    const r = row as Record<string, unknown>;
    const kt = readKeyText(r.key);
    if (kt === keyText) return r.value;
  }
  return undefined;
}

function getOutputs(payload: Record<string, unknown>): Record<string, unknown> | null {
  const state = payload.state as Record<string, unknown> | undefined;
  const completed = state?.completed as Record<string, unknown> | undefined;
  const outputs = completed?.outputs as Record<string, unknown> | undefined;
  return outputs ?? null;
}

function getIdpRoot(outputs: Record<string, unknown>): unknown {
  return outputs.idp_extraction_results ?? outputs.idpExtractionResults;
}

/** For logs: unwrap axis Value and return the inner Long object or primitive. */
function rawLongPayloadForLog(axisVal: unknown): unknown {
  const leaf = unwrapProtoValueLayers(axisVal);
  if (!leaf || typeof leaf !== "object" || Array.isArray(leaf)) return leaf;
  const o = leaf as Record<string, unknown>;
  if (o.number != null) return o.number;
  if (isLongNumberShape(o)) {
    return {
      lo: o.lo,
      hi: o.hi,
      mid: o.mid,
      flags: o.flags,
    };
  }
  return leaf;
}

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

function parseOneFieldItemWithTrace(
  item: unknown,
  documentName: string,
  index: number,
): { highlight: IdPdfFieldHighlight | null; trace: IdpFieldParseTrace } {
  const o = item as Record<string, unknown> | undefined;
  const dict = o?.dictionary as Record<string, unknown> | undefined;
  const entries = dict?.entries;
  const m = entryListToValueMap(entries);
  const parsedMapKeys = [...m.keys()];

  const rawBBoxNodes: Record<string, unknown> = {};
  const bboxVal = m.get("bounding_box") ?? m.get("boundingBox");
  const bboxLeaf = unwrapProtoValueLayers(bboxVal) as Record<string, unknown> | undefined;
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

  const decodedBBox: { x?: number; y?: number; width?: number; height?: number } = {
    x: readNumberFromValueMapEntry(bboxMap.get("x")),
    y: readNumberFromValueMapEntry(bboxMap.get("y")),
    width: readNumberFromValueMapEntry(bboxMap.get("width")),
    height: readNumberFromValueMapEntry(bboxMap.get("height")),
  };

  let skipReason: string | null = null;
  if (elementType?.toLowerCase() !== "extracted_field") {
    skipReason = `element_type is not extracted_field (got ${elementType ?? "undefined"})`;
  } else if (!name || shouldSkipFieldName(name)) {
    skipReason = !name ? "missing name" : `name blocklisted or empty (${name})`;
  } else if (pageNumber == null || !Number.isFinite(pageNumber) || pageNumber < 1) {
    skipReason = `invalid page_number (${String(pageNumber)})`;
  } else {
    const bbox = parseBoundingBox(bboxVal);
    if (!bbox) {
      skipReason = "bounding_box missing or failed x/y/width/height validation";
    } else {
      const conf =
        confidence != null && Number.isFinite(confidence) ? confidence : null;
      const bboxCoordMode = inferBboxOverlayCoordMode(bbox);
      if (idpBboxLogEnabled()) {
        console.log(
          "[idp-bbox]",
          JSON.stringify(
            {
              fieldName: name,
              rawNumber: {
                x: rawLongPayloadForLog(bboxMap.get("x")),
                y: rawLongPayloadForLog(bboxMap.get("y")),
                width: rawLongPayloadForLog(bboxMap.get("width")),
                height: rawLongPayloadForLog(bboxMap.get("height")),
              },
              decoded: { ...bbox },
              bboxCoordMode,
            },
            replacerForLog,
            2,
          ),
        );
      }
      const highlight: IdPdfFieldHighlight = {
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

/** Last path segment of `user_inputs.invoice.file.remote` (or fallback). */
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

export type IdpHighlightPayloadDiagnostics = {
  /** True when `row.payload` is a non-null object (the JSON column value). */
  payloadIsObject: boolean;
  /** `row.payload.state.completed.outputs.idp_extraction_results` is present. */
  hasIdpExtractionResults: boolean;
  /** `fields.value.list.items` length (0 if path missing). */
  fieldsListItemsLength: number;
  /** Items in that list with `element_type === "extracted_field"`. */
  extractedFieldItemsCount: number;
  /** Highlights returned by `parseIdpInvoiceFieldHighlights(row.payload)`. */
  normalizedHighlightsCount: number;
};

/**
 * Inspect `kognitos_runs.payload` (same object the API returns as `payload`).
 * Paths match stored JSON: `state.completed.outputs.idp_extraction_results.dictionary.entries`
 * → `fields` → `value.list.items`.
 */
export function getIdpHighlightPayloadDiagnostics(
  rowPayload: unknown,
): IdpHighlightPayloadDiagnostics {
  const empty: IdpHighlightPayloadDiagnostics = {
    payloadIsObject: false,
    hasIdpExtractionResults: false,
    fieldsListItemsLength: 0,
    extractedFieldItemsCount: 0,
    normalizedHighlightsCount: 0,
  };
  if (!rowPayload || typeof rowPayload !== "object" || Array.isArray(rowPayload)) {
    return empty;
  }
  const payload = rowPayload as Record<string, unknown>;
  const outputs = getOutputs(payload);
  const idpRaw =
    outputs?.idp_extraction_results ?? outputs?.idpExtractionResults ?? null;
  const hasIdpExtractionResults =
    idpRaw != null && typeof idpRaw === "object" && !Array.isArray(idpRaw);

  let fieldsListItemsLength = 0;
  let extractedFieldItemsCount = 0;
  if (hasIdpExtractionResults) {
    const idpRec = idpRaw as Record<string, unknown>;
    const topEntries =
      (idpRec.dictionary as Record<string, unknown> | undefined)?.entries ??
      idpRec.entries;
    const fieldsValue = protoMapGet(topEntries, "fields");
    if (fieldsValue != null && typeof fieldsValue === "object") {
      const fv = fieldsValue as Record<string, unknown>;
      const list = fv.list as Record<string, unknown> | undefined;
      const items = (list?.items ?? fv.items) as unknown[] | undefined;
      if (Array.isArray(items)) {
        fieldsListItemsLength = items.length;
        for (const item of items) {
          const io = item as Record<string, unknown> | undefined;
          const dict = io?.dictionary as Record<string, unknown> | undefined;
          const fm = entryListToValueMap(dict?.entries);
          const elementType =
            readTextFromValueMapEntry(fm.get("element_type")) ??
            readTextFromValueMapEntry(fm.get("elementType"));
          if (elementType?.toLowerCase() === "extracted_field") {
            extractedFieldItemsCount += 1;
          }
        }
      }
    }
  }

  const normalizedHighlightsCount = parseIdpInvoiceFieldHighlights(payload).length;

  return {
    payloadIsObject: true,
    hasIdpExtractionResults,
    fieldsListItemsLength,
    extractedFieldItemsCount,
    normalizedHighlightsCount,
  };
}

/**
 * Extracts `extracted_field` entries from the `fields` list in IDP results.
 * Expects the raw JSON from `kognitos_runs.payload` (not a wrapper object).
 */
export function parseIdpInvoiceFieldHighlights(
  payload: Record<string, unknown>,
): IdPdfFieldHighlight[] {
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

  const out: IdPdfFieldHighlight[] = [];
  for (let i = 0; i < items.length; i++) {
    const { highlight, trace } = parseOneFieldItemWithTrace(
      items[i],
      documentName,
      i,
    );
    if (idpFieldDebugEnabled()) {
      console.log("[idp-field-parse]", JSON.stringify(trace, replacerForLog, 2));
    }
    if (highlight) out.push(highlight);
  }
  return out;
}

function replacerForLog(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** Display confidence for UI (same rules as tooltip: fraction 0–1 → percent, else rounded number). */
export function formatConfidenceForTooltip(c: number | null): string {
  if (c == null || !Number.isFinite(c)) return "—";
  if (c > 0 && c <= 1) return String(Math.round(c * 100));
  return String(Math.round(c));
}

export function formatHighlightTooltip(h: IdPdfFieldHighlight): string {
  const conf = formatConfidenceForTooltip(h.confidence);
  return [
    h.label,
    `Value: ${h.value || "—"}`,
    `Confidence: ${conf}`,
    `Document: ${h.documentName}`,
    `Page: ${h.pageNumber}`,
  ].join("\n");
}
