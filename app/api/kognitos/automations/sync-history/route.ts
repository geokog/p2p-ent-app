import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Recent per-automation sync passes (append-only log). New automations appear
 * automatically after their first successful sync.
 */
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing", entries: [] },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const raw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(raw)
    ? Math.min(MAX_LIMIT, Math.max(1, raw))
    : DEFAULT_LIMIT;

  const { data: rows, error } = await supabaseAdmin
    .from("kognitos_automation_sync_history")
    .select(
      "id, synced_at, new_runs_inserted, runs_fetched_from_api, runs_skipped_duplicates, sync_mode, kognitos_automation_id",
    )
    .order("synced_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: error.message, entries: [] },
      { status: 500 },
    );
  }

  const list = rows ?? [];
  const autoIds = [...new Set(list.map((r) => String(r.kognitos_automation_id)))];
  let autoMap = new Map<
    string,
    { display_name: string | null; automation_id: string }
  >();
  if (autoIds.length > 0) {
    const { data: autos, error: autoErr } = await supabaseAdmin
      .from("kognitos_automations")
      .select("id, display_name, automation_id")
      .in("id", autoIds);
    if (!autoErr && autos) {
      autoMap = new Map(
        autos.map((a) => [
          String(a.id),
          {
            display_name:
              typeof a.display_name === "string" ? a.display_name : null,
            automation_id: String(a.automation_id ?? ""),
          },
        ]),
      );
    }
  }

  const entries = list.map((r) => {
    const aid = String(r.kognitos_automation_id);
    const meta = autoMap.get(aid);
    return {
      id: String(r.id),
      synced_at: String(r.synced_at),
      new_runs_inserted: Number(r.new_runs_inserted ?? 0),
      runs_fetched_from_api: Number(r.runs_fetched_from_api ?? 0),
      runs_skipped_duplicates: Number(r.runs_skipped_duplicates ?? 0),
      sync_mode: String(r.sync_mode ?? "incremental"),
      kognitos_automation_id: aid,
      automation_display_name: meta?.display_name ?? null,
      automation_short_id: meta?.automation_id ?? null,
    };
  });

  return NextResponse.json({ entries });
}
