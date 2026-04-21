/**
 * Pull vendor / invoice / amount strings from Kognitos IDP blobs that use the
 * protobuf JSON shape: nested `dictionary.entries` with `key.text` / `value`.
 * Field rows include `name` (e.g. vendor_name) and `values.list.items[].text`.
 */

function scalarTextFromProtobufValue(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.stringValue === "string" && o.stringValue.trim()) {
    return o.stringValue.trim();
  }
  if (typeof o.string_value === "string" && o.string_value.trim()) {
    return o.string_value.trim();
  }
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  return undefined;
}

function firstTextFromValuesNode(valuesNode: unknown): string | undefined {
  if (!valuesNode || typeof valuesNode !== "object" || Array.isArray(valuesNode)) {
    return undefined;
  }
  const o = valuesNode as Record<string, unknown>;
  const list = (o.list as Record<string, unknown> | undefined)?.items ?? o.items;
  if (!Array.isArray(list)) return undefined;
  for (const item of list) {
    const t = scalarTextFromProtobufValue(item);
    if (t) return t;
  }
  return undefined;
}

function tryFlattenProtobufDictionary(
  obj: Record<string, unknown>,
): Record<string, unknown> | null {
  const entries = obj.entries;
  if (!Array.isArray(entries)) return null;
  const out: Record<string, unknown> = {};
  for (const e of entries) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const ent = e as Record<string, unknown>;
    const keyRaw = ent.key;
    const val = ent.value;
    const keyText = scalarTextFromProtobufValue(keyRaw);
    if (!keyText) continue;
    out[keyText] = val;
  }
  return Object.keys(out).length ? out : null;
}

const VENDOR_FIELD = /^(vendor_name|supplier(_name)?|vendor_legal_name|seller(_name)?|bill_to_name)$/i;

const INVOICE_FIELD =
  /^(vendor_invoice_number|invoice_number|invoice_id|invoice_no|sap_invoice_number)$/i;

const MONEY_FIELD =
  /^(total_amount|amount_due|invoice_total|grand_total|net_amount|gross_amount|subtotal|balance_due)$/i;

function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export type IdpExtractedHints = {
  vendor?: string;
  invoiceNumber?: string;
  totalAmount?: number;
};

/**
 * Walk any JSON subtree (run `payload`, `state.completed.outputs`, API `outputs`, etc.)
 * and collect IDP extraction rows.
 */
export function extractIdpProtobufHints(root: unknown): IdpExtractedHints {
  let vendor: string | undefined;
  let invoiceNumber: string | undefined;
  let totalAmount = 0;

  const visit = (flat: Record<string, unknown>): void => {
    const fieldName = scalarTextFromProtobufValue(flat.name);
    if (!fieldName) return;
    const extracted =
      scalarTextFromProtobufValue(flat.element_type)?.toLowerCase() ===
        "extracted_field" || flat.values != null;
    if (!extracted) return;

    const cell = firstTextFromValuesNode(flat.values);
    if (!cell) return;

    if (VENDOR_FIELD.test(fieldName)) {
      if (!vendor || cell.length > vendor.length) vendor = cell;
    } else if (INVOICE_FIELD.test(fieldName)) {
      if (!invoiceNumber || cell.length > invoiceNumber.length) {
        invoiceNumber = cell;
      }
    } else if (MONEY_FIELD.test(fieldName)) {
      const n = parseMoney(cell);
      if (n > totalAmount) totalAmount = n;
    }
  };

  const walk = (node: unknown, depth: number): void => {
    if (depth > 22 || node == null) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const flat = tryFlattenProtobufDictionary(o);
    if (flat) visit(flat);
    for (const v of Object.values(o)) walk(v, depth + 1);
  };

  walk(root, 0);
  return {
    vendor,
    invoiceNumber,
    totalAmount: totalAmount > 0 ? totalAmount : undefined,
  };
}
