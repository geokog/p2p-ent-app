"use client";

import { useEffect, useId, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Shared spreadsheet-style input class for automation-friendly cells. */
export const logisticsCellEditClass = cn(
  "cell-edit h-9 w-full min-w-[4rem] rounded border border-transparent bg-transparent px-1.5 text-sm outline-none transition-[color,box-shadow]",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

function parseDispatchLabel(s: string): Date | null {
  const d = parse(s.trim(), "M/d/yy", new Date());
  return isValid(d) ? d : null;
}

type DispatchDateCellProps = {
  rowIndex: number;
  outboundId: string;
  value: string;
  onValueChange: (next: string) => void;
};

export function DispatchDateCell({
  rowIndex,
  outboundId,
  value,
  onValueChange,
}: DispatchDateCellProps) {
  const [open, setOpen] = useState(false);
  const nativeDateInputId = useId();
  const parsed = parseDispatchLabel(value);
  const calendarValue = parsed ?? new Date();

  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(nativeDateInputId) as HTMLInputElement | null;
    if (!el) return;
    queueMicrotask(() => {
      el.focus();
      const anyEl = el as HTMLInputElement & { showPicker?: () => void };
      anyEl.showPicker?.();
    });
  }, [open, nativeDateInputId]);

  return (
    <div className="flex items-center gap-1.5 pr-0.5">
      <input
        id={`cell-dispatch-${rowIndex}`}
        type="text"
        className={cn(
          logisticsCellEditClass,
          "field-sizing-content max-w-none min-w-[7ch] w-auto shrink-0 tabular-nums",
        )}
        aria-label={`Logistics row ${rowIndex} Dispatch outbound ${outboundId}`}
        data-row={String(rowIndex)}
        data-field="dispatch"
        data-outbound-id={outboundId}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-label={`Open dispatch date calendar for row ${rowIndex} outbound ${outboundId}`}
            data-row={String(rowIndex)}
            data-field="dispatch-calendar"
            data-outbound-id={outboundId}
          >
            <CalendarDays className="size-4" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <label
            htmlFor={nativeDateInputId}
            className="mb-2 block text-xs text-muted-foreground"
          >
            Dispatch date
          </label>
          <Input
            id={nativeDateInputId}
            type="date"
            value={format(calendarValue, "yyyy-MM-dd")}
            aria-label={`Logistics row ${rowIndex} Dispatch calendar outbound ${outboundId}`}
            data-row={String(rowIndex)}
            data-field="dispatch-native-date"
            data-outbound-id={outboundId}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const next = parse(v, "yyyy-MM-dd", new Date());
              if (isValid(next)) {
                onValueChange(format(next, "M/d/yy"));
                setOpen(false);
              }
            }}
            className="min-h-10 w-[11.5rem]"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
