"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type WorkspaceAutomationRowProps = {
  id: string;
  title: string;
  description?: string;
  /** Short automation id (shown in ID chip when set). */
  automationId?: string;
  /** Opens Kognitos automation details in a new tab when the ID chip is linked. */
  automationDetailsUrl?: string | null;
  /** Remote total runs (QueryAutomationRunAggregates); omit when unknown. */
  totalRunsCount?: number;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
  /** When false, hides the “Registered” hint for locked rows (e.g. Settings list). */
  showRegisteredHint?: boolean;
};

export function WorkspaceAutomationListRow({
  id,
  title,
  description,
  automationId,
  automationDetailsUrl,
  totalRunsCount,
  checked,
  onCheckedChange,
  disabled,
  locked,
  showRegisteredHint = true,
}: WorkspaceAutomationRowProps) {
  const showMetaChips =
    Boolean(automationId) || totalRunsCount !== undefined;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border border-border/80 bg-card px-3 py-3",
        locked && "opacity-90",
      )}
    >
      <div className="flex items-start pt-0.5">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => onCheckedChange?.(v === true)}
          disabled={disabled || locked}
          aria-readonly={locked}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <Label
          htmlFor={id}
          className={cn("text-sm font-medium leading-none", locked && "cursor-default")}
        >
          {title}
        </Label>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
        {showMetaChips ? (
          <div className="flex flex-wrap gap-2">
            {automationId ? (
              automationDetailsUrl ? (
                <a
                  href={automationDetailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>ID:</span>
                  <span className="font-mono text-foreground underline-offset-2 hover:underline">
                    {automationId}
                  </span>
                </a>
              ) : (
                <div className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground">
                  <span className="text-muted-foreground">ID:</span>{" "}
                  <span className="font-mono text-foreground">{automationId}</span>
                </div>
              )
            ) : null}
            {totalRunsCount !== undefined ? (
              <div className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground">
                <span className="text-muted-foreground">Total Runs:</span>{" "}
                <span className="tabular-nums text-foreground">
                  {totalRunsCount}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {locked && showRegisteredHint ? (
          <p className="text-xs text-muted-foreground">Registered</p>
        ) : null}
      </div>
    </div>
  );
}
