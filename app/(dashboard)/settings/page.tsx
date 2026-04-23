"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Building2,
  Users,
  Save,
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DOMAIN } from "@/lib/domain.config";
import { useAuth } from "@/lib/auth-context";
import { WorkspaceAutomationListRow } from "@/components/kognitos/workspace-automation-list-row";
import { KognitosAutomationPickerDialog } from "@/components/kognitos/kognitos-automation-picker-dialog";

type AutomationRow = {
  id: string;
  automation_id: string;
  display_name: string | null;
  description: string | null;
  resource_name: string | null;
  total_runs: number;
  details_url: string | null;
  /** ISO timestamp from `kognitos_automations.last_runs_sync_at` */
  last_runs_sync_at: string | null;
  last_sync_new_runs_inserted: number;
};

function formatSyncedAt(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy, h:mm a");
  } catch {
    return iso;
  }
}

function formatSyncMode(mode: string): string {
  const m = mode.toLowerCase();
  if (m === "full") return "Full";
  if (m === "incremental") return "Incremental";
  return mode;
}

type SyncHistoryEntry = {
  id: string;
  synced_at: string;
  new_runs_inserted: number;
  runs_fetched_from_api: number;
  runs_skipped_duplicates: number;
  sync_mode: string;
  kognitos_automation_id: string;
  automation_display_name: string | null;
  automation_short_id: string | null;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [orgName, setOrgName] = useState("Example Organization");
  const [timezone, setTimezone] = useState("America/New_York");
  const [saved, setSaved] = useState(false);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  /** Per automation row UUID (`kognitos_automations.id`): undefined = not fetched yet */
  const [syncHistoryByAutomationId, setSyncHistoryByAutomationId] = useState<
    Record<string, SyncHistoryEntry[] | undefined>
  >({});
  const [expandedSyncAutomationId, setExpandedSyncAutomationId] = useState<
    string | null
  >(null);
  const [loadingKognitosSettings, setLoadingKognitosSettings] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const loadKognitosSettings = useCallback(async () => {
    setLoadingKognitosSettings(true);
    try {
      const autosRes = await fetch("/api/kognitos/automations");
      const autosJson = (await autosRes.json()) as {
        automations?: AutomationRow[];
      };
      if (autosRes.ok) {
        setAutomations(
          (autosJson.automations ?? []).map((a) => ({
            ...a,
            total_runs: a.total_runs ?? 0,
            details_url:
              typeof a.details_url === "string" && a.details_url.length > 0
                ? a.details_url
                : null,
            last_runs_sync_at:
              typeof a.last_runs_sync_at === "string"
                ? a.last_runs_sync_at
                : null,
            last_sync_new_runs_inserted:
              typeof a.last_sync_new_runs_inserted === "number"
                ? a.last_sync_new_runs_inserted
                : 0,
          })),
        );
      } else {
        setAutomations([]);
      }
      setSyncHistoryByAutomationId({});
    } finally {
      setLoadingKognitosSettings(false);
    }
  }, []);

  const fetchSyncHistoryForAutomation = useCallback(
    async (kognitosAutomationRowId: string) => {
      const params = new URLSearchParams({
        limit: "10",
        kognitos_automation_id: kognitosAutomationRowId,
      });
      const res = await fetch(
        `/api/kognitos/automations/sync-history?${params.toString()}`,
      );
      const json = (await res.json()) as { entries?: SyncHistoryEntry[] };
      const entries = res.ok ? (json.entries ?? []) : [];
      setSyncHistoryByAutomationId((prev) => ({
        ...prev,
        [kognitosAutomationRowId]: entries,
      }));
    },
    [],
  );

  function toggleSyncHistoryRow(kognitosAutomationRowId: string) {
    setExpandedSyncAutomationId((prev) =>
      prev === kognitosAutomationRowId ? null : kognitosAutomationRowId,
    );
  }

  useEffect(() => {
    const id = expandedSyncAutomationId;
    if (!id) return;
    if (syncHistoryByAutomationId[id] !== undefined) return;
    void fetchSyncHistoryForAutomation(id);
  }, [
    expandedSyncAutomationId,
    syncHistoryByAutomationId,
    fetchSyncHistoryForAutomation,
  ]);

  useEffect(() => {
    void loadKognitosSettings();
  }, [loadKognitosSettings]);

  useEffect(() => {
    const onDataChanged = () => {
      void loadKognitosSettings();
    };
    window.addEventListener("chat-data-changed", onDataChanged);
    return () => window.removeEventListener("chat-data-changed", onDataChanged);
  }, [loadKognitosSettings]);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const registeredIds = new Set(automations.map((a) => a.automation_id));
  const isAdmin = user?.role === "admin";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your {DOMAIN.appName} configuration
        </p>
      </div>

      {/* Organization Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Organization
          </CardTitle>
          <CardDescription>
            Update your organization information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} className="gap-2">
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
            {saved && (
              <span className="text-sm font-medium text-emerald-600">
                Settings saved successfully!
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kognitos automations</CardTitle>
          <CardDescription>
            Automations registered for sync and storage. Removals are not
            available in the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingKognitosSettings ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No automations registered.
            </p>
          ) : (
            <ScrollArea className="h-[min(320px,50vh)]">
              <div className="space-y-2 pr-3">
                {automations.map((a) => (
                  <WorkspaceAutomationListRow
                    key={a.id}
                    id={`reg-${a.id}`}
                    title={a.display_name || a.automation_id}
                    description={a.description ?? undefined}
                    automationId={a.automation_id}
                    automationDetailsUrl={a.details_url}
                    totalRunsCount={a.total_runs}
                    checked
                    locked
                    showRegisteredHint={false}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
          {isAdmin ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add automations
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only admins can register additional automations.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" aria-hidden />
            Run sync status
          </CardTitle>
          <CardDescription>
            Per automation: when the app last listed runs from Kognitos and updated
            Supabase (same action as the top bar sync), and how many new runs were
            inserted in that pass. Expand a row to see up to the last 10 sync passes
            for that automation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingKognitosSettings ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No automations registered. Register an automation above, then use the
              top bar refresh to pull runs from Kognitos.
            </p>
          ) : (
            <div className="divide-y rounded-md border border-border">
              {automations.map((a) => {
                const title = a.display_name?.trim() || a.automation_id;
                const expanded = expandedSyncAutomationId === a.id;
                const history = syncHistoryByAutomationId[a.id];

                return (
                  <div key={a.id} className="bg-card">
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
                      <button
                        type="button"
                        onClick={() => toggleSyncHistoryRow(a.id)}
                        className="flex min-w-0 max-w-full items-start gap-2 rounded-sm text-left text-sm font-semibold text-foreground outline-none ring-offset-background hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={expanded}
                      >
                        <span className="mt-0.5 shrink-0 text-muted-foreground">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 break-words">{title}</span>
                      </button>
                      <dl className="grid shrink-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 sm:gap-8">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Last sync
                          </dt>
                          <dd className="mt-0.5 tabular-nums text-muted-foreground">
                            {a.last_runs_sync_at
                              ? formatSyncedAt(a.last_runs_sync_at)
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            New runs inserted (last sync)
                          </dt>
                          <dd className="mt-0.5 tabular-nums text-muted-foreground">
                            {a.last_runs_sync_at != null
                              ? a.last_sync_new_runs_inserted
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    {expanded ? (
                      <div className="border-t border-border bg-muted/30 px-2 py-3 sm:px-4">
                        {history === undefined ? (
                          <p className="px-2 text-sm text-muted-foreground">
                            Loading sync history…
                          </p>
                        ) : history.length === 0 ? (
                          <p className="px-2 text-sm text-muted-foreground">
                            No sync history recorded for this automation yet. Use
                            the top bar refresh after runs exist in Kognitos.
                          </p>
                        ) : (
                          <div className="overflow-x-auto rounded-md border border-border bg-background">
                            <Table>
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="min-w-[11rem] whitespace-normal">
                                    Synced at
                                  </TableHead>
                                  <TableHead className="whitespace-normal">
                                    Mode
                                  </TableHead>
                                  <TableHead className="text-right tabular-nums whitespace-normal">
                                    Fetched
                                  </TableHead>
                                  <TableHead className="text-right tabular-nums whitespace-normal">
                                    Skipped
                                  </TableHead>
                                  <TableHead className="text-right tabular-nums whitespace-normal">
                                    New runs
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {history.map((row) => (
                                  <TableRow key={row.id}>
                                    <TableCell className="align-top tabular-nums text-muted-foreground">
                                      {formatSyncedAt(row.synced_at)}
                                    </TableCell>
                                    <TableCell className="align-top text-muted-foreground">
                                      {formatSyncMode(row.sync_mode)}
                                    </TableCell>
                                    <TableCell className="align-top text-right tabular-nums">
                                      {row.runs_fetched_from_api}
                                    </TableCell>
                                    <TableCell className="align-top text-right tabular-nums text-muted-foreground">
                                      {row.runs_skipped_duplicates}
                                    </TableCell>
                                    <TableCell className="align-top text-right tabular-nums font-medium text-foreground">
                                      {row.new_runs_inserted}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <KognitosAutomationPickerDialog
          mode="add"
          open={addOpen}
          blocking={false}
          registeredAutomationIds={registeredIds}
          title="Add Kognitos automations"
          onOpenChange={setAddOpen}
          onCompleted={() => {
            void loadKognitosSettings();
          }}
        />
      ) : null}

      <Separator />

      {/* Navigation Cards — CUSTOMIZE: Add links to domain-specific sub-pages. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/users">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 px-5 py-5">
              <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">User Management</p>
                <p className="text-sm text-muted-foreground">
                  Manage team members and roles
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
