import type { LogisticsRow, LogisticsTri } from "./logistics-static-data";

const STORAGE_KEY = "p2p_logistics_grid_rows_v1";

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

export function loadLogisticsRowsFromStorage(): LogisticsRow[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const rows = parsed.filter(isLogisticsRow);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

export function saveLogisticsRowsToStorage(rows: LogisticsRow[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // quota or private mode — ignore
  }
}
