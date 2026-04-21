/**
 * URL helpers for vendor profile routes. Names are encoded as a single path
 * segment (encodeURIComponent) so arbitrary legal names work in `/vendors/[vendorSlug]`.
 */

export function vendorProfileHref(vendorName: string): string | null {
  const t = vendorName.trim();
  if (!t || t === "—") return null;
  return `/vendors/${encodeURIComponent(t)}`;
}

/** Deterministic 7-digit-style id for display (not a master-data vendor id). */
export function stableVendorDisplayId(vendorName: string): string {
  let h = 5381;
  for (let i = 0; i < vendorName.length; i++) {
    h = (h * 33) ^ vendorName.charCodeAt(i);
  }
  const n = (Math.abs(h) % 9000000) + 1000000;
  return String(n);
}

export function decodeVendorSlugParam(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
