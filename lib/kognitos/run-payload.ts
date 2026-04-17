/**
 * Helpers for raw Kognitos run JSON (before mapRunFromApiJson), including protobuf-JSON field names.
 */

/** `request_id` on automation inputs (string or commonV1Value with text). */
export function getRequestIdFromRunPayload(
  payload: Record<string, unknown>,
): string | undefined {
  const ui = payload.userInputs ?? payload.user_inputs;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return undefined;
  const o = ui as Record<string, unknown>;
  const rid = o.request_id ?? o.requestId;
  if (typeof rid === "string") return rid;
  if (rid && typeof rid === "object" && rid !== null && "text" in rid) {
    const t = (rid as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  return undefined;
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
