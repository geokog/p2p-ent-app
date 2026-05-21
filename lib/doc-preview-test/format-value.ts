/**
 * Humanized value formatter for the right-panel value chip.
 *
 * Mirrors the contract from the document-preview skill:
 *   - Recurses through the shared protobuf unwrapper (`decodeIdpValue`).
 *   - Prefers `text` / `normalized_value` / `extracted_value` keys on
 *     dictionaries.
 *   - Treats numeric-keyed dictionaries (`{ "0": ..., "1": ... }`) as lists.
 *   - Returns the empty marker `"—"` for null/undefined/empty so callers
 *     can render an empty state in a quieter color.
 *
 * Never falls back to `JSON.stringify` — the chip would otherwise show the
 * raw protobuf wrappers and operators would lose trust in the surface.
 */

import { decodeIdpValue, decodeStructDecimal } from "./idp-decode";

const PREFER_KEYS = ["text", "normalized_value", "extracted_value"];

/**
 * Title-case a snake_case identifier (e.g. `vendor_invoice_number` →
 * `Vendor Invoice Number`). Used for both the row's primary label and
 * for keys when formatting a dictionary value.
 */
export function humanizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isListShapedDict(d: Record<string, unknown>): boolean {
  const keys = Object.keys(d);
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

export function formatIdpValue(raw: unknown): string {
  const v = decodeIdpValue(raw);

  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    return Number.isFinite(v) ? v.toLocaleString() : "—";
  }

  // Some Decimal-bit shapes survive `decodeIdpValue` if they show up in
  // unusual nesting — re-check before treating as a generic dictionary.
  const dec = decodeStructDecimal(v);
  if (dec !== null) return dec.toLocaleString();

  if (Array.isArray(v)) {
    return v.map(formatIdpValue).filter(Boolean).join(", ");
  }

  if (typeof v === "object") {
    const dict = v as Record<string, unknown>;
    for (const k of PREFER_KEYS) {
      if (k in dict) return formatIdpValue(dict[k]);
    }
    if (isListShapedDict(dict)) {
      return Object.keys(dict)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => formatIdpValue(dict[k]))
        .filter(Boolean)
        .join(", ");
    }
    return Object.entries(dict)
      .map(([k, val]) => `${humanizeFieldName(k)}: ${formatIdpValue(val)}`)
      .join("\n");
  }

  return "—";
}
