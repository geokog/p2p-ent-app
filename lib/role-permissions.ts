import { DOMAIN, getRoleConfig } from "@/lib/domain.config";

export type EntityAction = string;

export function canAccessPath(role: string, path: string): boolean {
  const config = getRoleConfig(role);
  if (!config) return false;
  if (config.allowedPaths.includes("*")) return true;

  const normalised = path.replace(/\/$/, "") || "/";
  return config.allowedPaths.some((allowed) => {
    if (allowed === "/") return normalised === "/";
    return normalised === allowed || normalised.startsWith(allowed + "/");
  });
}

export function canPerformAction(role: string, action: EntityAction): boolean {
  const config = getRoleConfig(role);
  if (!config) return false;
  const actions = config.actions as readonly string[];
  return actions.includes("*") || actions.includes(action);
}

export function getDefaultPath(role: string): string {
  return getRoleConfig(role)?.defaultPath ?? "/";
}

export function getAllRoles() {
  return DOMAIN.roles;
}
