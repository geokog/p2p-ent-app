import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { getRunRaw } from "./client-core";
import { getRunTimesFromPayload } from "./run-payload";
import { reindexKognitosRunInputsForRun } from "./reindex-run-inputs";

/**
 * Re-fetch each run from Kognitos GET Run and replace `kognitos_runs.payload` with unmapped JSON
 * (so `user_inputs` / `file.remote` are present). Re-runs `kognitos_run_inputs` indexing per row.
 */
export async function refreshAllRunPayloadsFromKognitos(): Promise<{
  ok: boolean;
  updated: number;
  failed: number;
  error?: string;
}> {
  if (!supabaseAdmin) {
    return { ok: false, updated: 0, failed: 0, error: "supabase_admin_missing" };
  }
  const hasBaseEnv =
    process.env.KOGNITOS_BASE_URL &&
    (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
    (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
    process.env.KOGNITOS_WORKSPACE_ID;
  if (!hasBaseEnv) {
    return { ok: false, updated: 0, failed: 0, error: "kognitos_env_missing" };
  }

  const { data: runs, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, kognitos_automation_id");
  if (error) return { ok: false, updated: 0, failed: 0, error: error.message };

  const uuidSet = new Set(
    (runs ?? []).map((r) => r.kognitos_automation_id as string).filter(Boolean),
  );
  const uuidList = [...uuidSet];
  if (uuidList.length === 0) {
    return { ok: true, updated: 0, failed: 0 };
  }

  const { data: autos, error: autoErr } = await supabaseAdmin
    .from("kognitos_automations")
    .select("id, automation_id")
    .in("id", uuidList);
  if (autoErr) return { ok: false, updated: 0, failed: 0, error: autoErr.message };

  const automationIdByUuid = new Map(
    (autos ?? []).map((a) => [a.id as string, a.automation_id as string]),
  );

  let updated = 0;
  let failed = 0;
  for (const row of runs ?? []) {
    const id = String(row.id);
    const uuid = row.kognitos_automation_id as string | null;
    const automationId = uuid ? automationIdByUuid.get(uuid) : undefined;
    if (!automationId) {
      failed += 1;
      continue;
    }
    try {
      const raw = await getRunRaw(id, automationId);
      if (!raw) {
        failed += 1;
        continue;
      }
      const times = getRunTimesFromPayload(raw);
      const nm = String(raw.name ?? "");
      const { error: upErr } = await supabaseAdmin
        .from("kognitos_runs")
        .update({
          payload: raw,
          ...(nm ? { name: nm } : {}),
          create_time: times.create,
          update_time: times.update,
        })
        .eq("id", id);
      if (upErr) {
        failed += 1;
        continue;
      }
      updated += 1;
      await reindexKognitosRunInputsForRun(id, raw);
    } catch {
      failed += 1;
    }
  }

  return { ok: true, updated, failed };
}
