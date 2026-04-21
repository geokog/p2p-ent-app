/**
 * Deep scans raw Kognitos run JSON for dashboard vendor / money hints when
 * flat `userInputs` keys are missing or use nested protobuf shapes.
 */

/** Invoice / AP counterparty — not automation names, generic org, or “customer”. */
const VENDOR_KEY =
  /(vendor|supplier|seller|bill[_\s]?to|ship[_\s]?to|remit|payee|counterparty|merchant|payer|from_party|to_party|legal[_\s]?name|vendor[_\s]?legal|supplier[_\s]?legal|invoice[_\s]?vendor|remit[_\s]?to|sold[_\s]?to|pay[_\s]?to)/i;

const VENDOR_KEY_SKIP =
  /(automation|workflow|playbook|template|process|match|sop|run_name|job|english_code|display_name)/i;

const MONEY_KEY =
  /(amount|value|total|price|cost|subtotal|grand|balance|due|invoice|payment|usd|grandtotal|line[_\s]?total|net[_\s]?amount|gross)/i;

/** Skip only blobs / metadata trees; keep `state` so `outputs` amounts are visible. */
const SKIP_KEYS = /^(binary|bytes|metadata|labels|annotations)$/i;

/** Short opaque run / correlation ids — not useful as “vendor” or line item. */
export function looksLikeOpaqueId(s: string): boolean {
  const t = s.trim();
  if (t.length < 10) return false;
  if (/^req-[\w-]+$/i.test(t)) return false;
  if (/^[0-9a-f-]{36}$/i.test(t)) return true;
  if (/^[A-Za-z0-9_-]{18,}$/.test(t) && !/\s/.test(t)) return true;
  return false;
}

function moneyFromAny(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e12) {
    return v;
  }
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.-]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 && n < 1e12 ? n : 0;
  }
  if (!v || typeof v !== "object") return 0;
  const o = v as Record<string, unknown>;
  if (typeof o.units === "string" || typeof o.units === "number") {
    const u = typeof o.units === "number" ? o.units : parseFloat(o.units);
    const nanos = typeof o.nanos === "number" ? o.nanos / 1e9 : 0;
    if (Number.isFinite(u) && u + nanos > 0 && u + nanos < 1e12) return u + nanos;
  }
  return 0;
}

function walkLeaves(
  obj: unknown,
  depth: number,
  out: Array<{ key: string; val: unknown }>,
): void {
  if (depth > 14 || obj == null) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkLeaves(item, depth + 1, out);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SKIP_KEYS.test(k)) continue;
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      walkLeaves(v, depth + 1, out);
    } else {
      out.push({ key: k, val: v });
    }
  }
}

function stringFromLeaf(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim()) return val.trim();
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (!val || typeof val !== "object" || Array.isArray(val)) return undefined;
  const o = val as Record<string, unknown>;
  if (typeof o.stringValue === "string" && o.stringValue.trim()) {
    return o.stringValue.trim();
  }
  if (typeof o.string_value === "string" && o.string_value.trim()) {
    return o.string_value.trim();
  }
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  return undefined;
}

/** Best-effort vendor / counterparty label from nested payload. */
export function deepVendorHint(payload: Record<string, unknown>): string | undefined {
  const leaves: Array<{ key: string; val: unknown }> = [];
  walkLeaves(payload, 0, leaves);
  let best: string | undefined;
  let bestLen = 0;
  for (const { key, val } of leaves) {
    if (VENDOR_KEY_SKIP.test(key)) continue;
    if (!VENDOR_KEY.test(key)) continue;
    const s = stringFromLeaf(val);
    if (!s || looksLikeOpaqueId(s)) continue;
    if (s.length > bestLen) {
      best = s;
      bestLen = s.length;
    }
  }
  return best;
}

/** Largest plausible monetary amount anywhere under the payload. */
export function deepMoneyHint(payload: Record<string, unknown>): number {
  const leaves: Array<{ key: string; val: unknown }> = [];
  walkLeaves(payload, 0, leaves);
  let best = 0;
  for (const { key, val } of leaves) {
    if (!MONEY_KEY.test(key)) continue;
    const n = moneyFromAny(val);
    if (n > best) best = n;
  }
  return best;
}

/** Human-readable title / description for line-item KPI (skip opaque ids). */
export function deepTitleHint(payload: Record<string, unknown>): string | undefined {
  const leaves: Array<{ key: string; val: unknown }> = [];
  walkLeaves(payload, 0, leaves);
  const titleKeys =
    /(title|subject|description|summary|invoice[_\s]?title|document[_\s]?name|memo|notes|display_name|displayName|english_code)/i;
  let best: string | undefined;
  let bestLen = 0;
  for (const { key, val } of leaves) {
    if (!titleKeys.test(key)) continue;
    const s = stringFromLeaf(val);
    if (!s || looksLikeOpaqueId(s)) continue;
    if (s.includes("/") && s.length > 48) continue;
    if (s.length > bestLen) {
      best = s;
      bestLen = s.length;
    }
  }
  return best;
}
