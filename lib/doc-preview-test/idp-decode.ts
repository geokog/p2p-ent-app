/**
 * Self-contained IDP value decoders for the document-preview-test bed.
 *
 * The IDP payload at `state.completed.outputs.idp_extraction_results` is a
 * free-form protobuf `Struct`: leaves can be primitives, `{ value: { ... } }`
 * wrapper layers, lists at `{ list: { items: [...] } }`, dictionaries at
 * `{ dictionary: { entries: [...] } }`, and numbers can arrive as
 * primitives, `{ number: ... }` shapes, or C# `Decimal`-style bit objects.
 *
 * Every consumer below (parser, value formatter, bbox decoder) unwraps via
 * the same helpers so that downstream code never branches on protobuf
 * layout details.
 */

/** Protobuf-JSON `dictionary.entries` row: `{ key, value }`. */
export type StructEntry = { key?: unknown; value?: unknown };

/**
 * Walk transparent `{ value: ... }` wrapper layers up to a depth limit.
 * Numbers, strings, arrays, and `null` short-circuit; only object-with-`value`
 * layers are unwrapped. Cap depth so a malicious / malformed cycle does not
 * spin.
 */
export function unwrapValueLayers(input: unknown, maxDepth = 12): unknown {
  let cur: unknown = input;
  for (let i = 0; i < maxDepth; i++) {
    if (cur == null) return cur;
    if (typeof cur !== "object" || Array.isArray(cur)) return cur;
    const obj = cur as Record<string, unknown>;
    if (obj.value != null && typeof obj.value === "object") {
      cur = obj.value;
      continue;
    }
    return cur;
  }
  return cur;
}

/** True when `o` matches the C#-style `Decimal.GetBits` shape. */
function isDecimalBitsShape(o: Record<string, unknown>): boolean {
  return typeof o.lo === "number" && typeof o.hi === "number";
}

/**
 * Decode `{ lo, hi, mid?, flags? }` as a System.Decimal-style 96-bit
 * unsigned magnitude (`lo | mid << 32 | hi << 64`) with the scale in
 * `flags` bits 16–23 (capped at 28) and sign in bit 31.
 *
 * The naive `lo / 2^32` shortcut is wrong for real IDP payloads: bbox
 * fractions like 0.0532 come out as ~0.000000012 with that decoder.
 */
export function decodeStructDecimal(input: unknown): number | null {
  const v = unwrapValueLayers(input);
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isDecimalBitsShape(o)) return null;

  const ulo = BigInt((o.lo as number) >>> 0);
  const umid = BigInt((typeof o.mid === "number" ? (o.mid as number) : 0) >>> 0);
  const uhi = BigInt((o.hi as number) >>> 0);
  const flags = typeof o.flags === "number" ? o.flags : 0;
  let scale = (flags >>> 16) & 0xff;
  if (scale > 28) scale = 28;
  const sign = (flags & 0x8000_0000) !== 0 ? -1 : 1;
  // Avoid BigInt literals (`64n`) so we don't need ES2020 target.
  const mag = (uhi << BigInt(64)) | (umid << BigInt(32)) | ulo;
  // `Number(BigInt)` is safe here — magnitude fits in 96 bits and IDP values
  // are bounded by document dimensions; we lose precision only past 2^53.
  const n = sign * (Number(mag) / Math.pow(10, scale));
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a leaf number from a protobuf `Value` / `Struct` node. Accepts:
 *   - primitives (number, numeric string)
 *   - `{ number: 42 }` / `{ number: { lo, hi, ... } }`
 *   - `{ value: { ... } }` wrapper layers
 *   - direct `{ lo, hi, ... }` Decimal bits
 * Returns `null` when nothing usable is found.
 */
export function readStructNumber(input: unknown, maxDepth = 12): number | null {
  let cur: unknown = input;
  for (let i = 0; i < maxDepth; i++) {
    if (cur == null) return null;
    if (typeof cur === "number" && Number.isFinite(cur)) return cur;
    if (typeof cur === "string") {
      const n = parseFloat(cur);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof cur !== "object" || Array.isArray(cur)) return null;
    const o = cur as Record<string, unknown>;

    if (isDecimalBitsShape(o)) {
      return decodeStructDecimal(o);
    }
    if (typeof o.number === "number" && Number.isFinite(o.number)) return o.number;
    if (typeof o.number === "string") {
      const n = parseFloat(o.number);
      if (Number.isFinite(n)) return n;
    }
    if (o.number && typeof o.number === "object" && !Array.isArray(o.number)) {
      const decoded = decodeStructDecimal(o.number);
      if (decoded != null) return decoded;
    }
    if (o.value != null && typeof o.value === "object") {
      cur = o.value;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Read a leaf string from a protobuf `Value` node. Accepts the common
 * `{ text: ... }` / `{ string_value: ... }` / nested `{ value: ... }`
 * shapes we have seen in the IDP `Struct`. Returns `null` when nothing
 * usable is found.
 */
export function readStructText(input: unknown, maxDepth = 12): string | null {
  let cur: unknown = input;
  for (let i = 0; i < maxDepth; i++) {
    if (typeof cur === "string") return cur.trim() || null;
    if (cur == null) return null;
    if (typeof cur !== "object" || Array.isArray(cur)) return null;
    const o = cur as Record<string, unknown>;
    if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
    if (typeof o.stringValue === "string" && o.stringValue.trim()) return o.stringValue.trim();
    if (typeof o.string_value === "string" && o.string_value.trim()) return o.string_value.trim();
    if (o.value != null && typeof o.value === "object") {
      cur = o.value;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Map a `dictionary.entries` array to `keyText → entry.value`.  Rows whose
 * key text cannot be read are silently dropped — this matches every IDP
 * sample we have inspected.
 */
export function entriesToValueMap(entries: unknown): Map<string, unknown> {
  const m = new Map<string, unknown>();
  if (!Array.isArray(entries)) return m;
  for (const row of entries) {
    if (!row || typeof row !== "object") continue;
    const r = row as StructEntry;
    const k = readStructText(r.key);
    if (k) m.set(k, r.value);
  }
  return m;
}

/**
 * Resolve the entries array for a node that may be either
 * `{ dictionary: { entries: [...] } }` or a flat `{ entries: [...] }`.
 */
export function readDictEntries(input: unknown): unknown {
  const v = unwrapValueLayers(input);
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const dict = o.dictionary as Record<string, unknown> | undefined;
  return dict?.entries ?? o.entries ?? null;
}

/** Resolve `list.items` (preferred) or `items` from a list-shaped node. */
export function readListItems(input: unknown): unknown[] | null {
  const v = unwrapValueLayers(input);
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const list = o.list as Record<string, unknown> | undefined;
  const items = list?.items ?? o.items;
  return Array.isArray(items) ? items : null;
}

/**
 * Decode an IDP `Value` to a "plain" JS value (primitives, arrays, plain
 * dictionaries). The caller (e.g. the value chip formatter) walks the
 * resulting tree without protobuf branching.
 *
 * Detection order matters: `decodeStructDecimal` runs before plain object
 * fall-through so we don't return the raw `{ lo, hi, flags }` shape as a
 * dictionary.
 */
export function decodeIdpValue(input: unknown): unknown {
  const v = unwrapValueLayers(input);
  if (v == null) return null;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(decodeIdpValue);

  const o = v as Record<string, unknown>;

  if (isDecimalBitsShape(o)) {
    const dec = decodeStructDecimal(o);
    return dec ?? null;
  }

  // Primitives expressed as a single-key wrapper (`{ text: "..." }`,
  // `{ number: 42 }`, `{ boolean: true }`, `{ null_value: ... }`).
  if (typeof o.text === "string") return o.text;
  if (typeof o.string_value === "string") return o.string_value;
  if (typeof o.stringValue === "string") return o.stringValue;
  if (typeof o.boolean === "boolean") return o.boolean;
  if (typeof o.bool === "boolean") return o.bool;
  if ("null_value" in o || "nullValue" in o) return null;
  if (typeof o.number === "number") return o.number;
  if (o.number != null && typeof o.number === "object") {
    const n = decodeStructDecimal(o.number);
    if (n != null) return n;
  }

  // Lists / dictionaries — recursively flatten.
  const items = readListItems(o);
  if (items) return items.map(decodeIdpValue);

  const entries = readDictEntries(o);
  if (Array.isArray(entries)) {
    const out: Record<string, unknown> = {};
    for (const row of entries) {
      if (!row || typeof row !== "object") continue;
      const r = row as StructEntry;
      const k = readStructText(r.key);
      if (!k) continue;
      out[k] = decodeIdpValue(r.value);
    }
    return out;
  }

  // Already-mapped plain dictionary that doesn't look protobuf-shaped: pass
  // through entry-by-entry so nested protobuf wrappers still get unwrapped.
  const passthrough: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) {
    passthrough[k] = decodeIdpValue(val);
  }
  return passthrough;
}
