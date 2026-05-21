"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OrganizationOption = { id: string; title: string };
type WorkspaceOption = { id: string; title: string };
type AutomationOption = {
  id: string;
  displayName: string;
  updateTime: string | null;
  /** `null` when the automation has never been published. */
  latestPublishedVersion: string | null;
  /** Soft-delete timestamp; only present when "Show deleted" is on. */
  deleteTime: string | null;
};

type StageFilter = "all" | "draft" | "published";

const STAGE_FILTER_OPTIONS: { value: StageFilter; label: string }[] = [
  { value: "all", label: "All stages" },
  { value: "draft", label: "Draft only" },
  { value: "published", label: "Published only" },
];

type AutomationCode = {
  id: string;
  displayName: string;
  spyCode: string;
  englishCode: string;
  updateTime: string | null;
  version: string | null;
  latestPublishedVersion: string | null;
};

type ApiError = { error?: string };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && body !== null
        ? ((body as ApiError).error ?? `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return (body ?? {}) as T;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function DeveloperPage() {
  const [orgs, setOrgs] = useState<OrganizationOption[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string>("");

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string>("");

  const [automations, setAutomations] = useState<AutomationOption[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationsError, setAutomationsError] = useState<string | null>(null);
  const [automationId, setAutomationId] = useState<string>("");

  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [showDeleted, setShowDeleted] = useState<boolean>(false);

  const [code, setCode] = useState<AutomationCode | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOrgsLoading(true);
    setOrgsError(null);
    fetchJson<{ organizations: OrganizationOption[] }>(
      "/api/kognitos/developer/organizations",
    )
      .then((data) => {
        if (cancelled) return;
        setOrgs(data.organizations ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOrgs([]);
        setOrgsError(e instanceof Error ? e.message : "Failed to load organizations");
      })
      .finally(() => {
        if (!cancelled) setOrgsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!orgId) {
      setWorkspaces([]);
      setWorkspaceId("");
      setWorkspacesError(null);
      setWorkspacesLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspacesLoading(true);
    setWorkspacesError(null);
    setWorkspaces([]);
    setWorkspaceId("");
    fetchJson<{ workspaces: WorkspaceOption[] }>(
      `/api/kognitos/developer/organizations/${encodeURIComponent(orgId)}/workspaces`,
    )
      .then((data) => {
        if (cancelled) return;
        setWorkspaces(data.workspaces ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setWorkspaces([]);
        setWorkspacesError(
          e instanceof Error ? e.message : "Failed to load workspaces",
        );
      })
      .finally(() => {
        if (!cancelled) setWorkspacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!orgId || !workspaceId) {
      setAutomations([]);
      setAutomationId("");
      setAutomationsError(null);
      setAutomationsLoading(false);
      return;
    }
    let cancelled = false;
    setAutomationsLoading(true);
    setAutomationsError(null);
    setAutomations([]);
    setAutomationId("");
    const params = new URLSearchParams();
    params.set("stage", stageFilter);
    params.set("show_deleted", showDeleted ? "true" : "false");
    fetchJson<{ automations: AutomationOption[] }>(
      `/api/kognitos/developer/organizations/${encodeURIComponent(
        orgId,
      )}/workspaces/${encodeURIComponent(workspaceId)}/automations?${params}`,
    )
      .then((data) => {
        if (cancelled) return;
        setAutomations(data.automations ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAutomations([]);
        setAutomationsError(
          e instanceof Error ? e.message : "Failed to load automations",
        );
      })
      .finally(() => {
        if (!cancelled) setAutomationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, workspaceId, stageFilter, showDeleted]);

  // Clear loaded code whenever the selection or filters change — staleness is
  // more confusing than an empty state, especially since each automation's SPy
  // can be very long and visually similar at a glance.
  useEffect(() => {
    setCode(null);
    setCodeError(null);
    setCopied(false);
  }, [orgId, workspaceId, automationId, stageFilter, showDeleted]);

  const canRun = Boolean(orgId && workspaceId && automationId) && !codeLoading;

  const onRun = useCallback(async () => {
    if (!orgId || !workspaceId || !automationId) return;
    setCodeLoading(true);
    setCodeError(null);
    setCode(null);
    setCopied(false);
    try {
      const data = await fetchJson<{ automation: AutomationCode }>(
        `/api/kognitos/developer/organizations/${encodeURIComponent(
          orgId,
        )}/workspaces/${encodeURIComponent(
          workspaceId,
        )}/automations/${encodeURIComponent(automationId)}/code`,
      );
      setCode(data.automation);
    } catch (e) {
      setCodeError(
        e instanceof Error ? e.message : "Failed to load automation code",
      );
    } finally {
      setCodeLoading(false);
    }
  }, [orgId, workspaceId, automationId]);

  const onCopy = useCallback(async () => {
    if (!code?.spyCode) return;
    try {
      await navigator.clipboard.writeText(code.spyCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable in non-secure contexts; surface nothing
      // rather than throw — the user can still select-and-copy from the <pre>.
    }
  }, [code?.spyCode]);

  const guidance = useMemo(() => {
    if (!orgId) {
      return "Select an organization to begin. Then pick a workspace and an automation, and click Go to view the SPy code.";
    }
    if (!workspaceId) {
      return "Pick a workspace inside the selected organization, then choose an automation.";
    }
    if (!automationId) {
      return "Choose an automation in the selected workspace, then click Go to view its SPy code.";
    }
    return "Click Go to fetch the SPy code for the selected automation.";
  }, [orgId, workspaceId, automationId]);

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-start gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"
          aria-hidden
        >
          <Code2 className="size-5" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Developer</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Browse Kognitos automations across organizations and workspaces and
            view their SPy (Subset-of-Python) source code.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Pick an organization, workspace, and automation, then click Go.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <FilterField
              label="Organization"
              loading={orgsLoading}
              error={orgsError}
              hint={
                orgs.length === 0 && !orgsLoading && !orgsError
                  ? "No organizations available."
                  : null
              }
            >
              <Select
                value={orgId || undefined}
                onValueChange={(v) => setOrgId(v)}
                disabled={orgsLoading || orgs.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      orgsLoading ? "Loading organizations…" : "Select organization"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="truncate">{o.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField
              label="Workspace"
              loading={workspacesLoading}
              error={workspacesError}
              hint={
                !orgId
                  ? "Select an organization first."
                  : workspaces.length === 0 && !workspacesLoading && !workspacesError
                    ? "No workspaces in this organization."
                    : null
              }
            >
              <Select
                value={workspaceId || undefined}
                onValueChange={(v) => setWorkspaceId(v)}
                disabled={
                  !orgId ||
                  workspacesLoading ||
                  (workspaces.length === 0 && !workspacesError)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      !orgId
                        ? "Select organization first"
                        : workspacesLoading
                          ? "Loading workspaces…"
                          : "Select workspace"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="truncate">{w.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField
              label="Automation"
              loading={automationsLoading}
              error={automationsError}
              hint={
                !workspaceId
                  ? "Select a workspace first."
                  : automations.length === 0 &&
                      !automationsLoading &&
                      !automationsError
                    ? stageFilter === "all" && !showDeleted
                      ? "No automations in this workspace."
                      : "No automations match the current stage / deleted filters."
                    : `${automations.length} automation${automations.length === 1 ? "" : "s"} available.`
              }
            >
              <Select
                value={automationId || undefined}
                onValueChange={(v) => setAutomationId(v)}
                disabled={
                  !workspaceId ||
                  automationsLoading ||
                  (automations.length === 0 && !automationsError)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      !workspaceId
                        ? "Select workspace first"
                        : automationsLoading
                          ? "Loading automations…"
                          : "Select automation"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-[60vh]">
                  {automations.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{a.displayName}</span>
                          <AutomationStageBadge automation={a} />
                          {a.deleteTime ? (
                            <Badge
                              variant="destructive"
                              className="text-[10px]"
                              title={`Deleted ${a.deleteTime}`}
                            >
                              deleted
                            </Badge>
                          ) : null}
                        </span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {a.id}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <div className="flex items-end">
              <Button
                type="button"
                onClick={() => void onRun()}
                disabled={!canRun}
                className="w-full lg:w-auto"
              >
                {codeLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Go
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-end sm:gap-6">
            <FilterField label="Stage" hint="Filter automations by publish stage.">
              <Select
                value={stageFilter}
                onValueChange={(v) => setStageFilter(v as StageFilter)}
                disabled={!workspaceId}
              >
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="All stages" />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <label className="flex select-none items-center gap-2 text-sm">
              <Checkbox
                checked={showDeleted}
                onCheckedChange={(v) => setShowDeleted(v === true)}
                disabled={!workspaceId}
                aria-label="Show soft-deleted automations"
              />
              <span>Show deleted</span>
              <span className="text-xs text-muted-foreground">
                (sets <code className="font-mono">show_deleted=true</code> on the
                request)
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {codeError ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{codeError}</p>
          </CardContent>
        </Card>
      ) : null}

      {code ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <CardTitle className="truncate">
                    {code.displayName}
                  </CardTitle>
                  <AutomationStageBadge
                    automation={{
                      latestPublishedVersion: code.latestPublishedVersion,
                    }}
                  />
                </div>
                <CardDescription className="font-mono text-xs">
                  {code.id}
                  {code.version ? ` · v${code.version}` : ""}
                  {code.latestPublishedVersion
                    ? ` · published v${code.latestPublishedVersion}`
                    : ""}
                  {code.updateTime
                    ? ` · updated ${formatTimestamp(code.updateTime)}`
                    : ""}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onCopy()}
                disabled={!code.spyCode}
                aria-label="Copy SPy code"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {code.spyCode ? (
              <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed">
                <code className="font-mono">{code.spyCode}</code>
              </pre>
            ) : (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                This automation has no SPy source. It may be a brand-new draft
                that hasn&apos;t been edited yet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : codeLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading SPy code…
            </span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            {guidance}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Small lifecycle badge derived from `latestPublishedVersion`. The list
 * endpoint omits a per-row `stage` field, so this is the most reliable signal
 * we have:
 *   - `null` → never published → "draft"
 *   - non-null → at least one published revision exists → "published"
 *
 * Rendered both inside the dropdown and on the loaded code card header.
 */
function AutomationStageBadge({
  automation,
}: {
  automation: { latestPublishedVersion: string | null };
}) {
  const isPublished = Boolean(automation.latestPublishedVersion);
  return (
    <Badge
      variant={isPublished ? "success" : "outline"}
      className="text-[10px] font-medium"
      title={
        isPublished
          ? `Published v${automation.latestPublishedVersion}`
          : "Has never been published"
      }
    >
      {isPublished ? "published" : "draft"}
    </Badge>
  );
}

function FilterField({
  label,
  loading,
  error,
  hint,
  children,
}: {
  label: string;
  loading?: boolean;
  error?: string | null;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        {loading ? (
          <Loader2
            className="size-3 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
