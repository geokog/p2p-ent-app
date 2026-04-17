import type { RawAutomation } from "./client-core";

function enumString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
  }
  return "";
}

/**
 * True if ListAutomations JSON describes a published automation.
 * Prefer `stage` (matches `filter=stage = "PUBLISHED"`); fall back to `state`
 * and publish metadata if filters are ignored.
 */
export function isPublishedAutomationRaw(a: RawAutomation): boolean {
  const stageStr = enumString(a.stage ?? a.automation_stage ?? a.automationStage);
  if (stageStr) {
    const u = stageStr.toUpperCase();
    if (
      u === "DRAFT" ||
      u.endsWith("_DRAFT") ||
      u.includes("AUTOMATION_STAGE_DRAFT") ||
      (u.includes("DRAFT") && !u.includes("PUBLISH"))
    ) {
      return false;
    }
    if (
      u === "PUBLISHED" ||
      u.endsWith("_PUBLISHED") ||
      u.includes("AUTOMATION_STAGE_PUBLISHED")
    ) {
      return true;
    }
  }

  const stateRaw = a.state;
  let stateStr = "";
  if (typeof stateRaw === "string") {
    stateStr = stateRaw;
  } else if (stateRaw && typeof stateRaw === "object") {
    const o = stateRaw as Record<string, unknown>;
    if (typeof o.name === "string") stateStr = o.name;
  }

  const u = stateStr.toUpperCase();
  if (
    u === "DRAFT" ||
    u.endsWith("_DRAFT") ||
    u.includes("AUTOMATION_STATE_DRAFT") ||
    (u.includes("DRAFT") && !u.includes("PUBLISH"))
  ) {
    return false;
  }
  if (
    u === "PUBLISHED" ||
    u.endsWith("_PUBLISHED") ||
    u.includes("AUTOMATION_STATE_PUBLISHED")
  ) {
    return true;
  }

  const lpv = a.latest_published_version ?? a.latestPublishedVersion;
  if (typeof lpv === "string" && lpv.trim().length > 0) {
    return true;
  }

  const pt = a.publish_time ?? a.publishTime;
  if (pt != null && String(pt).trim().length > 0) {
    return true;
  }

  const act = String(a.activation_state ?? a.activationState ?? "").toUpperCase();
  if (
    act &&
    !act.includes("UNSPECIFIED") &&
    (act.includes("ACTIVE") || act.includes("DEACTIVATED"))
  ) {
    return true;
  }

  return false;
}
