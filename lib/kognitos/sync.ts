import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { ensureAutomationFromEnv } from "./ensure-automation-from-env";
import { getAutomationRaw, listAllRunsForAutomationRaw } from "./client-core";
import { getRunTimesFromPayload } from "./run-payload";
import { reindexKognitosRunInputsForRun } from "./reindex-run-inputs";
import { runShortIdFromName } from "./stage";

async function listExistingRunIds(): Promise<Set<string>> {
  if (!supabaseAdmin) return new Set();
  const { data, error } = await supabaseAdmin.from("kognitos_runs").select("id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.id as string));
}

async function getLatestRunCreateTimeIsoForAutomation(
  automationUuid: string,
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("create_time")
    .eq("kognitos_automation_id", automationUuid)
    .order("create_time", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error || data == null || data.create_time == null) return null;
  const t = data.create_time as string;
  return typeof t === "string" ? t : new Date(t).toISOString();
}

function buildIncrementalCreateTimeFilter(lastCreateTimeIso: string): string {
  return `create_time >= "${lastCreateTimeIso}"`;
}

/**
 * Fetches each registered automation from the Kognitos API and updates
 * display metadata in Supabase (needed for env-bootstrap rows with null names).
 */
async function hydrateRegisteredAutomationsFromKognitos(): Promise<void> {
  if (!supabaseAdmin) return;
  const { data: rows, error } = await supabaseAdmin
    .from("kognitos_automations")
    .select("id, automation_id");
  if (error || !rows?.length) return;

  for (const row of rows) {
    const automationId = String(row.automation_id);
    try {
      const raw = await getAutomationRaw(automationId);
      const name = String(raw.name ?? "");
      const displayName =
        typeof raw.display_name === "string" && raw.display_name.trim()
          ? raw.display_name
          : automationId;
      const desc =
        typeof raw.description === "string" && raw.description
          ? raw.description
          : typeof raw.english_code === "string"
            ? raw.english_code
            : null;
      const { error: upErr } = await supabaseAdmin
        .from("kognitos_automations")
        .update({
          resource_name: name || null,
          display_name: displayName,
          description: desc,
        })
        .eq("id", row.id);
      if (upErr) throw upErr;
    } catch {
      /* leave row for a later refresh if the API is unavailable */
    }
  }
}

export type KognitosRefreshResult = {
  ok: boolean;
  written: boolean;
  newRuns: number;
  newRunIds: string[];
  mode: "full" | "incremental";
  sinceCreateTime: string | null;
  fetchedFromKognitos: number;
  skippedAlreadyInDb: number;
  automationsProcessed: number;
  error?: string;
};

export async function runKognitosRefresh(): Promise<KognitosRefreshResult> {
  if (!supabaseAdmin) {
    return {
      ok: false,
      written: false,
      newRuns: 0,
      newRunIds: [],
      mode: "full",
      sinceCreateTime: null,
      fetchedFromKognitos: 0,
      skippedAlreadyInDb: 0,
      automationsProcessed: 0,
      error: "supabase_admin_missing",
    };
  }

  await ensureAutomationFromEnv();

  const { data: automationRows, error: autoErr } = await supabaseAdmin
    .from("kognitos_automations")
    .select("id, automation_id");
  if (autoErr) throw autoErr;
  const automations = automationRows ?? [];
  if (automations.length === 0) {
    return {
      ok: false,
      written: false,
      newRuns: 0,
      newRunIds: [],
      mode: "full",
      sinceCreateTime: null,
      fetchedFromKognitos: 0,
      skippedAlreadyInDb: 0,
      automationsProcessed: 0,
      error: "no_automations_registered",
    };
  }

  const existingIds = await listExistingRunIds();
  let skippedAlreadyInDb = 0;
  let fetchedFromKognitos = 0;
  const allInserted: string[] = [];
  let lastMode: "full" | "incremental" = "full";
  let lastSince: string | null = null;

  for (const row of automations) {
    const automationUuid = String(row.id);
    const automationId = String(row.automation_id);

    const lastCreateIso = await getLatestRunCreateTimeIsoForAutomation(
      automationUuid,
    );
    const isFullBackfill = lastCreateIso == null;
    const filter = isFullBackfill
      ? undefined
      : buildIncrementalCreateTimeFilter(lastCreateIso);

    const remote = await listAllRunsForAutomationRaw({
      pageSize: 100,
      filter,
      automationId,
    });
    fetchedFromKognitos += remote.length;
    lastMode = isFullBackfill ? "full" : "incremental";
    lastSince = lastCreateIso;

    for (const run of remote) {
      const name = String(run.name ?? "");
      const id = runShortIdFromName(name);
      if (!id) continue;
      if (existingIds.has(id)) {
        skippedAlreadyInDb += 1;
        continue;
      }

      const times = getRunTimesFromPayload(run);
      const rowInsert = {
        id,
        name,
        payload: run,
        create_time: times.create,
        update_time: times.update,
        kognitos_automation_id: automationUuid,
      };
      const { error } = await supabaseAdmin
        .from("kognitos_runs")
        .insert(rowInsert);
      if (error) {
        if (error.code === "23505") {
          skippedAlreadyInDb += 1;
          existingIds.add(id);
          continue;
        }
        throw error;
      }
      allInserted.push(id);
      existingIds.add(id);

      await reindexKognitosRunInputsForRun(
        id,
        rowInsert.payload as Record<string, unknown>,
      );
    }
  }

  await hydrateRegisteredAutomationsFromKognitos();

  if (allInserted.length === 0) {
    return {
      ok: true,
      written: false,
      newRuns: 0,
      newRunIds: [],
      mode: lastMode,
      sinceCreateTime: lastSince,
      fetchedFromKognitos,
      skippedAlreadyInDb,
      automationsProcessed: automations.length,
    };
  }

  return {
    ok: true,
    written: true,
    newRuns: allInserted.length,
    newRunIds: allInserted,
    mode: lastMode,
    sinceCreateTime: lastSince,
    fetchedFromKognitos,
    skippedAlreadyInDb,
    automationsProcessed: automations.length,
  };
}
