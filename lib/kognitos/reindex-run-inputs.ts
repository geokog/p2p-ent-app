import { supabaseAdmin } from "@/lib/supabase";
import {
  extractFileRefsFromKognitosPayload,
  normalizeKognitosFileIdForDownload,
} from "./extract-run-input-files";

/**
 * Delete and re-insert `kognitos_run_inputs` for one run from raw API payload.
 * Skips `file.remote` values that are full URLs (use Kognitos file id paths for downloads).
 */
export async function reindexKognitosRunInputsForRun(
  kognitosRunId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!supabaseAdmin) return;

  const refs = extractFileRefsFromKognitosPayload(payload);

  await supabaseAdmin
    .from("kognitos_run_inputs")
    .delete()
    .eq("kognitos_run_id", kognitosRunId);

  type Row = {
    kognitos_run_id: string;
    input_key: string;
    kognitos_file_id: string;
    file_name: string | null;
    remote_raw: string | null;
    meta: Record<string, unknown>;
  };

  const byInputKey = new Map<string, Row>();

  for (const r of refs) {
    if (!r.remote || /^https?:\/\//i.test(r.remote)) continue;
    const fileId = normalizeKognitosFileIdForDownload(r.remote);
    if (!fileId) continue;
    byInputKey.set(r.inputKey, {
      kognitos_run_id: kognitosRunId,
      input_key: r.inputKey,
      kognitos_file_id: fileId,
      file_name: r.inlineFileName,
      remote_raw: r.remote,
      meta: {},
    });
  }

  const rows = [...byInputKey.values()];
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from("kognitos_run_inputs").insert(rows);
  if (error) {
    console.error("kognitos_run_inputs insert:", error.message);
  }
}

/** Reindex inputs for every run in `kognitos_runs` (service role). */
export async function reindexAllKognitosRunInputsFromDb(): Promise<void> {
  if (!supabaseAdmin) return;
  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, payload");
  if (error) throw error;
  for (const row of data ?? []) {
    const id = String(row.id);
    const payload = row.payload as Record<string, unknown>;
    await reindexKognitosRunInputsForRun(id, payload);
  }
}
