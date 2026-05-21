/**
 * Parameter-driven Kognitos read adapters used by the in-app "Developer" page
 * to browse automations across orgs/workspaces (rather than the env-pinned
 * org/workspace that `client-core.ts` uses).
 *
 * The base URL and bearer token still come from env (`KOGNITOS_BASE_URL` plus
 * `KOGNITOS_PAT` or `KOGNITOS_API_KEY`) via `kognitosFetchJson`. Org and
 * workspace ids are passed in by the caller so the page can swap targets
 * without touching env.
 */

import { kognitosFetchJson } from "./client-core";

export type DeveloperOrganization = {
  id: string;
  title: string;
};

export type DeveloperWorkspace = {
  id: string;
  title: string;
};

export type DeveloperAutomationSummary = {
  id: string;
  displayName: string;
  updateTime: string | null;
  /**
   * Semver of the most recently published revision, or `null` if the
   * automation has never been published. The list endpoint does not return a
   * `stage` field per row, so this is the only way to tell pure drafts from
   * automations that have a published revision.
   */
  latestPublishedVersion: string | null;
  /** Soft-delete timestamp; only present when `show_deleted=true`. */
  deleteTime: string | null;
};

export type AutomationStageFilter = "all" | "draft" | "published";

export type DeveloperAutomationCode = {
  id: string;
  displayName: string;
  /** SPy (Subset-of-Python) source. May be empty for new/draft automations. */
  spyCode: string;
  /** English rendering of the same logic, when available. */
  englishCode: string;
  updateTime: string | null;
  version: string | null;
  latestPublishedVersion: string | null;
};

function shortIdFromResource(name: string, segment: string): string {
  if (!name) return "";
  const parts = name.split("/");
  const idx = parts.lastIndexOf(segment);
  if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1];
  return parts.pop() ?? name;
}

function pickString(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function nextTokenFrom(raw: Record<string, unknown>): string | null {
  const snake = raw.next_page_token;
  const camel = raw.nextPageToken;
  if (typeof snake === "string" && snake) return snake;
  if (typeof camel === "string" && camel) return camel;
  return null;
}

/**
 * GET /api/v1/me/organizations — every org the current PAT/API key user is a
 * member of. Uses `user_organizations` per `v1CurrentUserOrganizationsResponse`.
 */
export async function listOrganizationsForCurrentUser(): Promise<DeveloperOrganization[]> {
  const out: DeveloperOrganization[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams();
    params.set("page_size", "1000");
    if (pageToken) params.set("page_token", pageToken);
    const path = `/api/v1/me/organizations?${params}`;
    const data = await kognitosFetchJson<Record<string, unknown>>(path);
    const raw = (data.user_organizations ??
      data.userOrganizations ??
      data.organizations ??
      []) as unknown[];
    for (const item of raw) {
      const o = (item ?? {}) as Record<string, unknown>;
      const fullName = pickString(o, "name");
      const id = fullName ? shortIdFromResource(fullName, "organizations") : "";
      const title = pickString(o, "title", "display_name", "displayName");
      if (!id) continue;
      out.push({ id, title: title || id });
    }
    pageToken = nextTokenFrom(data);
  } while (pageToken);
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * GET /api/v1/me/organizations/{org}/workspaces — workspaces in `orgId` that
 * the current user has access to. Prefer over the org-scoped ListWorkspaces
 * because it doesn't require org admin permissions.
 */
export async function listWorkspacesInOrg(
  orgId: string,
): Promise<DeveloperWorkspace[]> {
  const out: DeveloperWorkspace[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams();
    params.set("page_size", "1000");
    if (pageToken) params.set("page_token", pageToken);
    const path = `/api/v1/me/organizations/${encodeURIComponent(orgId)}/workspaces?${params}`;
    const data = await kognitosFetchJson<Record<string, unknown>>(path);
    const raw = (data.user_workspaces ??
      data.userWorkspaces ??
      data.workspaces ??
      []) as unknown[];
    for (const item of raw) {
      const w = (item ?? {}) as Record<string, unknown>;
      const fullName = pickString(w, "name");
      const id = fullName ? shortIdFromResource(fullName, "workspaces") : "";
      const title = pickString(w, "title", "display_name", "displayName");
      if (!id) continue;
      out.push({ id, title: title || id });
    }
    pageToken = nextTokenFrom(data);
  } while (pageToken);
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * Paginate ListAutomations until exhausted. Returns lightweight summaries
 * suitable for a dropdown — full SPy code is only fetched on demand.
 *
 * Stage filtering is done **client-side** because the OpenAPI-documented
 * `filter=state="PUBLISHED"|"DRAFT"` query parameter is currently ignored by
 * the upstream Kognitos list endpoint (verified against
 * `app.us-1.stg.kognitos.com` on 2026-05-08 — same 99-row response regardless
 * of the filter value). We still send the parameter so the server gains the
 * benefit if the upstream ever starts honoring it, but we treat
 * `latest_published_version` (returned per row) as the source of truth:
 *
 *   - `latest_published_version != null` ⇒ the automation has at least one
 *     published revision → "published"
 *   - `latest_published_version == null` ⇒ never published → "draft"
 *
 * `showDeleted`:
 *   - `true`  → request soft-deleted automations as well (`delete_time` is set
 *     on each returned row).
 *   - `false` (default) → matches the API default; deleted rows are hidden.
 */
export async function listAutomationsInWorkspace(
  orgId: string,
  workspaceId: string,
  options?: { stage?: AutomationStageFilter; showDeleted?: boolean },
): Promise<DeveloperAutomationSummary[]> {
  const stage: AutomationStageFilter = options?.stage ?? "all";
  const showDeleted = options?.showDeleted === true;
  const out: DeveloperAutomationSummary[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams();
    params.set("page_size", "1000");
    params.set("show_deleted", showDeleted ? "true" : "false");
    // Send the documented filter for forward-compatibility (currently ignored
    // upstream — see jsdoc above).
    if (stage === "published") {
      params.set("filter", 'state = "PUBLISHED"');
    } else if (stage === "draft") {
      params.set("filter", 'state = "DRAFT"');
    }
    if (pageToken) params.set("page_token", pageToken);
    const path = `/api/v1/organizations/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}/automations?${params}`;
    const data = await kognitosFetchJson<Record<string, unknown>>(path);
    const raw = (data.automations ?? data.automation ?? []) as unknown[];
    for (const item of raw) {
      const a = (item ?? {}) as Record<string, unknown>;
      const fullName = pickString(a, "name");
      const id = fullName ? shortIdFromResource(fullName, "automations") : "";
      const displayName = pickString(a, "display_name", "displayName");
      const updateTime = pickString(a, "update_time", "updateTime") || null;
      const latestPublishedVersion =
        pickString(a, "latest_published_version", "latestPublishedVersion") ||
        null;
      const deleteTime = pickString(a, "delete_time", "deleteTime") || null;
      if (!id) continue;
      if (stage === "draft" && latestPublishedVersion) continue;
      if (stage === "published" && !latestPublishedVersion) continue;
      out.push({
        id,
        displayName: displayName || "Untitled",
        updateTime,
        latestPublishedVersion,
        deleteTime,
      });
    }
    pageToken = nextTokenFrom(data);
  } while (pageToken);
  out.sort((a, b) => {
    // Stable order: newest update first (matches Kognitos default), then by name.
    const at = a.updateTime ? Date.parse(a.updateTime) : 0;
    const bt = b.updateTime ? Date.parse(b.updateTime) : 0;
    if (at !== bt) return bt - at;
    return a.displayName.localeCompare(b.displayName);
  });
  return out;
}

/**
 * GET /api/v1/organizations/{org}/workspaces/{ws}/automations/{id} — the full
 * automation resource. The shape carries both `code` (SPy / Subset-of-Python)
 * and `english_code`; either may be empty for never-published drafts.
 */
export async function getAutomationCode(
  orgId: string,
  workspaceId: string,
  automationId: string,
): Promise<DeveloperAutomationCode> {
  const path = `/api/v1/organizations/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}/automations/${encodeURIComponent(automationId)}`;
  const raw = await kognitosFetchJson<Record<string, unknown>>(path);
  return {
    id: automationId,
    displayName: pickString(raw, "display_name", "displayName") || "Untitled",
    spyCode: pickString(raw, "code"),
    englishCode: pickString(raw, "english_code", "englishCode"),
    updateTime: pickString(raw, "update_time", "updateTime") || null,
    version: pickString(raw, "version") || null,
    latestPublishedVersion:
      pickString(raw, "latest_published_version", "latestPublishedVersion") ||
      null,
  };
}
