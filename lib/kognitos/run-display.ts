/**
 * Display helpers for raw run JSON in `kognitos_runs.payload` (protobuf JSON may use snake_case).
 */

function runStateObject(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const st = payload.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) return null;
  return st as Record<string, unknown>;
}

export function kognitosRunStatusFromPayload(
  payload: Record<string, unknown>,
): string {
  const s = runStateObject(payload);
  if (!s) return "Executing";
  if (s.completed) return "Completed";
  if (s.failed) return "Failed";
  if (s.awaitingGuidance || s.awaiting_guidance) return "Awaiting Guidance";
  return "Executing";
}

/**
 * True when `payload.state.completed` is present (run finished the automation path
 * with a completed record). Used to gate validation tags: until then, inferred
 * DOC/QTY/VAL/COA flags are not treated as confirmed “wrong submitted values”.
 */
export function kognitosRunReachedCompletedState(
  payload: Record<string, unknown>,
): boolean {
  const s = runStateObject(payload);
  return Boolean(s?.completed);
}

/** ISO timestamp when the run reached completed state, if applicable. */
export function kognitosRunCompletedAtIso(
  payload: Record<string, unknown>,
  rowUpdateTime: string | null,
): string | null {
  const s = runStateObject(payload);
  if (!s?.completed) return null;
  const ut = payload.updateTime ?? payload.update_time;
  if (typeof ut === "string" && ut.length > 0) return ut;
  if (rowUpdateTime) return rowUpdateTime;
  return null;
}
