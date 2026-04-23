"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Building2,
  Users,
  Save,
  ChevronRight,
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

function formatLastRunsSync(iso: string | null): string {
  if (!iso) return "Not yet synced";
  try {
    return format(new Date(iso), "MMM d, yyyy, h:mm a");
  } catch {
    return iso;
  }
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [orgName, setOrgName] = useState("Example Organization");
  const [timezone, setTimezone] = useState("America/New_York");
  const [saved, setSaved] = useState(false);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [loadingAutos, setLoadingAutos] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const loadAutomations = useCallback(async () => {
    setLoadingAutos(true);
    try {
      const res = await fetch("/api/kognitos/automations");
      const json = (await res.json()) as { automations?: AutomationRow[] };
      if (res.ok)
        setAutomations(
          (json.automations ?? []).map((a) => ({
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
    } finally {
      setLoadingAutos(false);
    }
  }, []);

  useEffect(() => {
    void loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    const onDataChanged = () => {
      void loadAutomations();
    };
    window.addEventListener("chat-data-changed", onDataChanged);
    return () => window.removeEventListener("chat-data-changed", onDataChanged);
  }, [loadAutomations]);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const registeredIds = new Set(automations.map((a) => a.automation_id));
  const isAdmin = user?.role === "admin";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
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
          {loadingAutos ? (
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
            Per automation: when the app last listed runs from Kognitos and
            updated Supabase (same action as the top bar sync), and how many new
            runs were inserted in that pass.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAutos ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Register an automation above to see sync status.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {automations.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-border bg-muted/25 p-4 shadow-sm"
                >
                  <p className="font-semibold leading-snug text-foreground">
                    {a.display_name?.trim() || a.automation_id}
                  </p>
                  <dl className="mt-3 space-y-2.5 text-sm">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Last sync
                      </dt>
                      <dd className="mt-0.5 tabular-nums text-foreground">
                        {formatLastRunsSync(a.last_runs_sync_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        New runs inserted (last sync)
                      </dt>
                      <dd className="mt-0.5 tabular-nums text-foreground">
                        {a.last_sync_new_runs_inserted}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
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
            void loadAutomations();
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
