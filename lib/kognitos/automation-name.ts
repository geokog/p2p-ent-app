/**
 * Extract short automation id from ListAutomations `name`, e.g.
 * `organizations/x/workspaces/y/automations/my-auto` → `my-auto`.
 */
export function automationShortIdFromResourceName(name: string): string | null {
  const parts = name.split("/").filter(Boolean);
  const i = parts.indexOf("automations");
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1] ?? null;
  return null;
}
