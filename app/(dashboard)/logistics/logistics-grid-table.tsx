"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-context";
import { kognitosDashboardFetch } from "@/lib/kognitos/kognitos-dashboard-fetch";
import { parseLogisticsRowsJson } from "@/lib/logistics/parse-logistics-rows";
import type { LogisticsRow, LogisticsTri } from "@/lib/logistics/logistics-row";
import { cn } from "@/lib/utils";
import { DispatchDateCell, logisticsCellEditClass } from "./dispatch-date-cell";
import { LOGISTICS_ROWS } from "./logistics-static-data";

const PERSIST_DEBOUNCE_MS = 450;

function cloneDefaults(): LogisticsRow[] {
  return LOGISTICS_ROWS.map((r) => ({ ...r }));
}

function triToCellValue(t: LogisticsTri): string {
  if (t === null) return "";
  return t ? "yes" : "no";
}

function HeaderLabel({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span>{children}</span>
      <ChevronDown
        className="size-3 shrink-0 text-muted-foreground opacity-70"
        aria-hidden
      />
    </div>
  );
}

type TextFieldKey = Exclude<
  keyof LogisticsRow,
  "live" | "completed" | "arrived" | "ignore" | "dispatch" | "plannedArrival"
>;

/** Text columns before status / dispatch / planned arrival. */
const LEADING_TEXT_FIELDS: TextFieldKey[] = [
  "outboundId",
  "carrierId",
  "trailerId",
  "trailerType",
  "outboundTypeId",
  "transportationTypeId",
];

const COLUMN_IDS: Record<string, string> = {
  outboundId: "col-outbound-id",
  carrierId: "col-carrier-id",
  trailerId: "col-trailer-id",
  trailerType: "col-trailer-type",
  outboundTypeId: "col-outbound-type-id",
  transportationTypeId: "col-transportation-type-id",
  live: "col-live",
  completed: "col-completed",
  dispatch: "col-dispatch",
  plannedArrival: "col-planned-arrival",
  arrived: "col-arrived",
  ignore: "col-ignore",
};

const FIELD_ARIA_SEGMENT: Record<TextFieldKey | "plannedArrival", string> = {
  outboundId: "Outbound ID",
  carrierId: "Carrier ID",
  trailerId: "Trailer ID",
  trailerType: "Trailer type",
  outboundTypeId: "Outbound type ID",
  transportationTypeId: "Transportation type ID",
  plannedArrival: "Planned arrival",
};

function fieldAriaLabel(
  rowIndex: number,
  field: TextFieldKey | "plannedArrival" | "Live" | "Completed" | "Arrived" | "Ignore",
  outboundId: string,
): string {
  const segment =
    typeof field === "string" && field in FIELD_ARIA_SEGMENT
      ? FIELD_ARIA_SEGMENT[field as keyof typeof FIELD_ARIA_SEGMENT]
      : field;
  return `Logistics row ${rowIndex} ${segment} outbound ${outboundId}`;
}

export function LogisticsGridTable() {
  const { user } = useAuth();
  const role = user?.role;

  const [rows, setRows] = useState<LogisticsRow[]>(cloneDefaults);
  const [readyToPersist, setReadyToPersist] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const skipNextPersist = useRef(false);

  const persistRows = useCallback(
    async (snapshot: LogisticsRow[]) => {
      if (!role) return;
      try {
        const res = await kognitosDashboardFetch("/api/logistics/rows", {
          method: "PUT",
          role,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: snapshot }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          setSaveError(json.error ?? `Save failed (${res.status})`);
          return;
        }
        setSaveError(null);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "save_failed");
      }
    },
    [role],
  );

  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const res = await kognitosDashboardFetch("/api/logistics/rows", {
          method: "GET",
          role,
        });
        const json = (await res.json()) as {
          rows?: unknown;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error ?? `Load failed (${res.status})`);
          return;
        }
        if (json.rows != null) {
          const parsed = parseLogisticsRowsJson(json.rows);
          if (parsed.ok) {
            if (parsed.rows.length > 0) {
              setRows(parsed.rows);
              skipNextPersist.current = true;
            } else {
              skipNextPersist.current = false;
            }
          } else {
            skipNextPersist.current = false;
          }
        } else {
          skipNextPersist.current = false;
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "load_failed");
        }
      } finally {
        if (!cancelled) {
          setReadyToPersist(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    if (!readyToPersist || !role) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void persistRows(rows);
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [rows, readyToPersist, role, persistRows]);

  function patchRow(index: number, patch: Partial<LogisticsRow>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function patchOutboundId(index: number, outboundId: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, outboundId } : r)),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Logistics</h1>
        <p className="text-muted-foreground">
          Outbound and trailer movements (sample static data for layout review).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Outbound shipments</CardTitle>
          <CardDescription>
            Edits are saved automatically to the database (debounced). Requires
            Supabase and a deployed{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              logistics_grid_state
            </code>{" "}
            migration.
          </CardDescription>
          {loadError ? (
            <p className="text-sm text-destructive">
              Could not load saved rows: {loadError}
            </p>
          ) : null}
          {saveError ? (
            <p className="text-sm text-destructive">
              Could not save: {saveError}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-4">
          <div className="mx-4 rounded-lg border bg-background">
            <Table role="grid" aria-label="Logistics">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    id={COLUMN_IDS.outboundId}
                    role="columnheader"
                    scope="col"
                    className="min-w-max whitespace-nowrap"
                  >
                    <HeaderLabel>Outbound ID</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.carrierId}
                    role="columnheader"
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    <HeaderLabel>Carrier ID</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.trailerId}
                    role="columnheader"
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    <HeaderLabel>Trailer ID</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.trailerType}
                    role="columnheader"
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    <HeaderLabel>Trailer type</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.outboundTypeId}
                    role="columnheader"
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    <HeaderLabel>Outbound type ID</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.transportationTypeId}
                    role="columnheader"
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    <HeaderLabel>Transportation type ID</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.live}
                    role="columnheader"
                    scope="col"
                    className="w-14 min-w-14 text-center"
                  >
                    <HeaderLabel>Live</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.completed}
                    role="columnheader"
                    scope="col"
                    className="w-20 min-w-20 text-center"
                  >
                    <HeaderLabel>Completed</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.dispatch}
                    role="columnheader"
                    scope="col"
                    className="min-w-max whitespace-nowrap"
                  >
                    <HeaderLabel>Dispatch</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.plannedArrival}
                    role="columnheader"
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    <HeaderLabel>Planned arrival</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.arrived}
                    role="columnheader"
                    scope="col"
                    className="w-16 min-w-16 text-center"
                  >
                    <HeaderLabel>Arrived</HeaderLabel>
                  </TableHead>
                  <TableHead
                    id={COLUMN_IDS.ignore}
                    role="columnheader"
                    scope="col"
                    className="w-14 min-w-14 text-center"
                  >
                    <HeaderLabel>Ignore</HeaderLabel>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => {
                  const rowNum = i + 1;
                  const oid = row.outboundId;
                  return (
                    <TableRow
                      key={i}
                      role="row"
                      data-row={String(rowNum)}
                      className={cn(i % 2 === 1 && "bg-muted/40")}
                    >
                      {LEADING_TEXT_FIELDS.map((field) => (
                        <TableCell
                          key={field}
                          role="gridcell"
                          headers={COLUMN_IDS[field]}
                          className={cn(
                            "p-1 align-middle",
                            field === "outboundId" &&
                              "min-w-max max-w-none overflow-visible",
                          )}
                        >
                          <input
                            type="text"
                            className={cn(
                              logisticsCellEditClass,
                              field === "outboundId" &&
                                "field-sizing-content max-w-none min-w-[11ch] w-auto font-mono tabular-nums",
                              (field === "carrierId" || field === "trailerId") &&
                                "font-mono",
                            )}
                            aria-label={fieldAriaLabel(rowNum, field, oid)}
                            data-row={String(rowNum)}
                            data-field={field}
                            data-outbound-id={oid}
                            id={`cell-${field}-${rowNum}`}
                            value={row[field]}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (field === "outboundId") {
                                patchOutboundId(i, v);
                                return;
                              }
                              patchRow(i, {
                                [field]: v,
                              } as Partial<LogisticsRow>);
                            }}
                          />
                        </TableCell>
                      ))}
                      <TableCell
                        role="gridcell"
                        headers={COLUMN_IDS.live}
                        className="p-1 text-center align-middle"
                      >
                        <input
                          type="text"
                          readOnly
                          tabIndex={0}
                          className={cn(
                            logisticsCellEditClass,
                            "cursor-default text-center",
                          )}
                          aria-label={fieldAriaLabel(rowNum, "Live", oid)}
                          data-row={String(rowNum)}
                          data-field="live"
                          data-outbound-id={oid}
                          id={`cell-live-${rowNum}`}
                          value={triToCellValue(row.live)}
                        />
                      </TableCell>
                      <TableCell
                        role="gridcell"
                        headers={COLUMN_IDS.completed}
                        className="p-1 text-center align-middle"
                      >
                        <input
                          type="text"
                          readOnly
                          tabIndex={0}
                          className={cn(
                            logisticsCellEditClass,
                            "cursor-default text-center",
                          )}
                          aria-label={fieldAriaLabel(rowNum, "Completed", oid)}
                          data-row={String(rowNum)}
                          data-field="completed"
                          data-outbound-id={oid}
                          id={`cell-completed-${rowNum}`}
                          value={triToCellValue(row.completed)}
                        />
                      </TableCell>
                      <TableCell
                        role="gridcell"
                        headers={COLUMN_IDS.dispatch}
                        className="min-w-max max-w-none overflow-visible p-1 align-middle"
                      >
                        <DispatchDateCell
                          rowIndex={rowNum}
                          outboundId={oid}
                          value={row.dispatch}
                          onValueChange={(next) => patchRow(i, { dispatch: next })}
                        />
                      </TableCell>
                      <TableCell
                        role="gridcell"
                        headers={COLUMN_IDS.plannedArrival}
                        className="p-1 align-middle"
                      >
                        <input
                          type="text"
                          className={cn(
                            logisticsCellEditClass,
                            "text-muted-foreground",
                          )}
                          aria-label={fieldAriaLabel(rowNum, "plannedArrival", oid)}
                          data-row={String(rowNum)}
                          data-field="plannedArrival"
                          data-outbound-id={oid}
                          id={`cell-plannedArrival-${rowNum}`}
                          value={row.plannedArrival}
                          onChange={(e) =>
                            patchRow(i, { plannedArrival: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell
                        role="gridcell"
                        headers={COLUMN_IDS.arrived}
                        className="p-1 text-center align-middle"
                      >
                        <input
                          type="text"
                          readOnly
                          tabIndex={0}
                          className={cn(
                            logisticsCellEditClass,
                            "cursor-default text-center",
                          )}
                          aria-label={fieldAriaLabel(rowNum, "Arrived", oid)}
                          data-row={String(rowNum)}
                          data-field="arrived"
                          data-outbound-id={oid}
                          id={`cell-arrived-${rowNum}`}
                          value={triToCellValue(row.arrived)}
                        />
                      </TableCell>
                      <TableCell
                        role="gridcell"
                        headers={COLUMN_IDS.ignore}
                        className="p-1 text-center align-middle"
                      >
                        <input
                          type="text"
                          readOnly
                          tabIndex={0}
                          className={cn(
                            logisticsCellEditClass,
                            "cursor-default text-center",
                          )}
                          aria-label={fieldAriaLabel(rowNum, "Ignore", oid)}
                          data-row={String(rowNum)}
                          data-field="ignore"
                          data-outbound-id={oid}
                          id={`cell-ignore-${rowNum}`}
                          value={triToCellValue(row.ignore)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
