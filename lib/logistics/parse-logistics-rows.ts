import type { LogisticsRow, LogisticsTri } from "@/lib/logistics/logistics-row";

function isTri(v: unknown): v is LogisticsTri {
  return v === null || typeof v === "boolean";
}

function isLogisticsRow(v: unknown): v is LogisticsRow {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.outboundId === "string" &&
    typeof o.carrierId === "string" &&
    typeof o.trailerId === "string" &&
    typeof o.trailerType === "string" &&
    typeof o.outboundTypeId === "string" &&
    typeof o.transportationTypeId === "string" &&
    isTri(o.live) &&
    isTri(o.completed) &&
    typeof o.dispatch === "string" &&
    typeof o.plannedArrival === "string" &&
    isTri(o.arrived) &&
    isTri(o.ignore)
  );
}

const MAX_ROWS = 500;

export type ParseLogisticsRowsResult =
  | { ok: true; rows: LogisticsRow[] }
  | { ok: false; error: string };

/** Validates JSON (e.g. from Supabase) as an array of logistics rows. */
export function parseLogisticsRowsJson(raw: unknown): ParseLogisticsRowsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "rows_must_be_array" };
  }
  if (raw.length > MAX_ROWS) {
    return { ok: false, error: "too_many_rows" };
  }
  if (raw.length === 0) {
    return { ok: true, rows: [] };
  }
  const rows: LogisticsRow[] = [];
  for (const item of raw) {
    if (!isLogisticsRow(item)) {
      return { ok: false, error: "invalid_row" };
    }
    rows.push(item);
  }
  return { ok: true, rows };
}
