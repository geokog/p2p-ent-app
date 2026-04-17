import type { KognitosRun } from "@/lib/types";

function normalizeUserInputs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (v !== null && typeof v === "object" && "stringValue" in v) {
      const s = (v as { stringValue?: string }).stringValue;
      out[k] = s ?? JSON.stringify(v);
    } else out[k] = v === undefined ? "" : JSON.stringify(v);
  }
  return out;
}

/** Map a Kognitos ListRuns/GetRun JSON object to our `KognitosRun` UI type. */
export function mapRunFromApiJson(api: Record<string, unknown>): KognitosRun {
  const inv = api.invocationDetails as Record<string, unknown> | undefined;
  const stage = api.stage;
  const stageStr =
    typeof stage === "string"
      ? stage
      : stage !== null && typeof stage === "object" && "name" in stage
        ? String((stage as { name?: string }).name ?? "")
        : String(stage ?? "");

  return {
    name: String(api.name ?? ""),
    createTime: String(api.createTime ?? api.create_time ?? ""),
    updateTime: String(api.updateTime ?? api.update_time ?? ""),
    state: (api.state ?? {}) as KognitosRun["state"],
    stage: stageStr,
    stageVersion: String(api.stageVersion ?? api.stage_version ?? ""),
    invocationDetails: {
      invocationSource: String(
        inv?.invocationSource ?? inv?.invocation_source ?? "API",
      ),
    },
    userInputs: normalizeUserInputs(api.userInputs ?? api.user_inputs),
  };
}

/** Deserialize a row from `kognitos_runs.payload` for the UI. */
export function parseKognitosRunPayload(raw: unknown): KognitosRun | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    return mapRunFromApiJson(raw as Record<string, unknown>);
  } catch {
    return null;
  }
}
