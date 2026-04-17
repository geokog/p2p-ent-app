/**
 * Builds the Kognitos web app URL for an automation’s details page, e.g.
 * `{origin}/organizations/{org}/workspaces/{ws}/automations/{automationId}/details`
 *
 * Uses `KOGNITOS_APP_BASE_URL` when set; otherwise derives an `app.*` origin
 * from `KOGNITOS_BASE_URL` (e.g. `api.us-1.stg` → `app.us-1.stg`).
 */

function appOriginFromEnv(): string | null {
  const explicit = process.env.KOGNITOS_APP_BASE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const apiBase = process.env.KOGNITOS_BASE_URL?.trim();
  if (!apiBase) return null;
  try {
    const u = new URL(apiBase);
    const host = u.hostname;
    if (host.startsWith("api.")) {
      u.hostname = `app.${host.slice(4)}`;
    }
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return u.origin;
  } catch {
    return null;
  }
}

export function getKognitosAutomationDetailsUrl(
  automationId: string,
): string | null {
  const id = automationId.trim();
  if (!id) return null;
  const origin = appOriginFromEnv();
  const org =
    process.env.KOGNITOS_ORGANIZATION_ID?.trim() ||
    process.env.KOGNITOS_ORG_ID?.trim() ||
    "";
  const ws = process.env.KOGNITOS_WORKSPACE_ID?.trim() || "";
  if (!origin || !org || !ws) return null;

  return `${origin}/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(ws)}/automations/${encodeURIComponent(id)}/details`;
}
