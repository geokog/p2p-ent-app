/**
 * Helpers for raw Kognitos run JSON (before mapRunFromApiJson), including protobuf-JSON field names.
 */

function requestIdFromValue(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  if (typeof o.stringValue === "string" && o.stringValue.trim()) {
    return o.stringValue.trim();
  }
  if (typeof o.string_value === "string" && o.string_value.trim()) {
    return o.string_value.trim();
  }
  return undefined;
}

/** `request_id` on automation inputs (string or commonV1Value with text). */
export function getRequestIdFromRunPayload(
  payload: Record<string, unknown>,
): string | undefined {
  const ui = payload.userInputs ?? payload.user_inputs;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return undefined;
  const o = ui as Record<string, unknown>;
  const rid = o.request_id ?? o.requestId;
  return requestIdFromValue(rid);
}

export function getRunTimesFromPayload(payload: Record<string, unknown>): {
  create: string | null;
  update: string | null;
} {
  const ct = payload.createTime ?? payload.create_time;
  const ut = payload.updateTime ?? payload.update_time;
  return {
    create: typeof ct === "string" ? ct : null,
    update: typeof ut === "string" ? ut : null,
  };
}
