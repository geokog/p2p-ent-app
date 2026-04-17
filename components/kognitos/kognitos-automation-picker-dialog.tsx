"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { kognitosDashboardFetch } from "@/lib/kognitos/kognitos-dashboard-fetch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { WorkspaceAutomationListRow } from "./workspace-automation-list-row";

export type DiscoverItem = {
  automation_id: string;
  resource_name: string;
  display_name: string;
  description: string;
  /** Remote Kognitos runs; selection is disabled when 0. */
  run_count: number;
  /** Kognitos UI details URL when server env can build it. */
  details_url: string | null;
};

type Props = {
  mode: "onboarding" | "add";
  open: boolean;
  /** When true, dialog cannot be dismissed until completed (onboarding). */
  blocking?: boolean;
  registeredAutomationIds?: Set<string>;
  title: string;
  onOpenChange?: (open: boolean) => void;
  onCompleted: () => void;
};

export function KognitosAutomationPickerDialog({
  mode,
  open,
  blocking,
  registeredAutomationIds,
  title,
  onOpenChange,
  onCompleted,
}: Props) {
  const { user } = useAuth();
  const role = user?.role;
  const [step, setStep] = useState<1 | 2>(1);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const available = useMemo(() => {
    if (mode === "onboarding") return items;
    const reg = registeredAutomationIds ?? new Set();
    return items.filter((i) => !reg.has(i.automation_id));
  }, [items, mode, registeredAutomationIds]);

  const loadDiscover = useCallback(async () => {
    if (!role) return;
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const res = await kognitosDashboardFetch("/api/kognitos/automations/discover", {
        method: "POST",
        role,
      });
      const json = (await res.json()) as {
        automations?: DiscoverItem[];
        error?: string;
      };
      if (!res.ok) {
        setDiscoverError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      const mapped = (json.automations ?? []).map((a) => ({
        ...a,
        run_count:
          typeof a.run_count === "number" && Number.isFinite(a.run_count)
            ? a.run_count
            : 0,
        details_url:
          typeof a.details_url === "string" && a.details_url.length > 0
            ? a.details_url
            : null,
      }));
      setItems(mapped);
      setSelected((prev) => {
        const next = new Set<string>();
        const reg = registeredAutomationIds ?? new Set();
        for (const id of prev) {
          const row = mapped.find((m) => m.automation_id === id);
          if (!row || row.run_count === 0) continue;
          if (mode === "add" && reg.has(id)) continue;
          next.add(id);
        }
        return next;
      });
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : "discover_failed");
    } finally {
      setDiscoverLoading(false);
    }
  }, [role, mode, registeredAutomationIds]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelected(new Set());
      void loadDiscover();
    }
  }, [open, loadDiscover]);

  function toggle(id: string, on: boolean) {
    const row = available.find((i) => i.automation_id === id);
    if (row && row.run_count === 0 && on) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!role || selected.size === 0) return;
    setSaving(true);
    try {
      const registrations = available
        .filter((i) => selected.has(i.automation_id) && i.run_count > 0)
        .map((i) => ({
          automation_id: i.automation_id,
          resource_name: i.resource_name,
          display_name: i.display_name,
          description: i.description || null,
        }));
      const res = await kognitosDashboardFetch("/api/kognitos/automations", {
        method: "POST",
        role,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrations }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        window.alert(json.error ?? `Save failed (${res.status})`);
        return;
      }

      const syncRes = await kognitosDashboardFetch("/api/kognitos/sync", {
        method: "POST",
        role,
      });
      const syncJson = (await syncRes.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!syncRes.ok) {
        const msg =
          syncJson.error === "no_automations_registered"
            ? "No automations are registered yet. Complete onboarding (admin) or add automations in Settings, then try again."
            : (syncJson.message ??
              syncJson.error ??
              `Kognitos sync failed (${syncRes.status})`);
        window.alert(msg);
      } else {
        window.dispatchEvent(new Event("chat-data-changed"));
      }

      onCompleted();
      onOpenChange?.(false);
    } finally {
      setSaving(false);
    }
  }

  const canContinue = selected.size > 0 && !discoverLoading && !saving;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && blocking) return;
        onOpenChange?.(v);
      }}
    >
      <DialogContent
        className="flex max-h-[min(90vh,640px)] flex-col gap-0 p-0 sm:max-w-lg"
        showCloseButton={!blocking}
        onPointerDownOutside={(e) => {
          if (blocking) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (blocking) e.preventDefault();
        }}
      >
        <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b px-6 py-4 space-y-0">
          <div className="min-w-0 flex-1 space-y-2">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">
              Select automations to register for this app.
            </DialogDescription>
          </div>
          {step === 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={discoverLoading || !role}
              onClick={() => void loadDiscover()}
              aria-label="Refresh automation list from Kognitos"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  discoverLoading && "animate-spin",
                )}
              />
              Refresh
            </Button>
          ) : null}
        </DialogHeader>

        {step === 1 ? (
          <>
            <div className="min-h-0 flex-1 px-2 py-2">
              {discoverError ? (
                <p className="px-4 text-sm text-destructive">{discoverError}</p>
              ) : null}
              {discoverLoading && items.length === 0 && !discoverError ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Loading automations…
                </p>
              ) : null}
              {!discoverLoading && available.length === 0 && !discoverError ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  {mode === "add"
                    ? "No additional automations to add in this workspace."
                    : "No automations found for this workspace."}
                </p>
              ) : null}
              <ScrollArea className="h-[min(50vh,360px)] px-4">
                <div className="space-y-2 pb-4 pr-2">
                  {available.map((i) => (
                    <WorkspaceAutomationListRow
                      key={i.automation_id}
                      id={`auto-${i.automation_id}`}
                      title={i.display_name || i.automation_id}
                      description={i.description || undefined}
                      automationId={i.automation_id}
                      automationDetailsUrl={i.details_url}
                      totalRunsCount={i.run_count}
                      disabled={i.run_count === 0}
                      checked={selected.has(i.automation_id)}
                      onCheckedChange={(c) => toggle(i.automation_id, c)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
            <DialogFooter className="border-t px-6 py-4">
              <Button
                type="button"
                disabled={!canContinue}
                onClick={() => setStep(2)}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground">
              <p>
                You are about to register{" "}
                <strong className="text-foreground">{selected.size}</strong>{" "}
                automation
                {selected.size === 1 ? "" : "s"} for this app.
              </p>
              <p>
                You cannot remove automations from the UI afterward. You can
                still add more later in Settings. Removing a registration later
                requires manual changes in Supabase (and may delete related
                synced runs).
              </p>
            </div>
            <DialogFooter className="border-t px-6 py-4 gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirm()}
              >
                {saving ? "Saving…" : "Confirm"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
