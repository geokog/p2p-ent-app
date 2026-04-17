import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

/**
 * If `KOGNITOS_AUTOMATION_ID` is set and no row exists for that id, insert one row.
 * Idempotent via UNIQUE(automation_id).
 */
export async function ensureAutomationFromEnv(): Promise<void> {
  if (!supabaseAdmin) return;
  const envId = process.env.KOGNITOS_AUTOMATION_ID?.trim();
  if (!envId) return;

  const { data: existing, error: selErr } = await supabaseAdmin
    .from("kognitos_automations")
    .select("id")
    .eq("automation_id", envId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return;

  const { error: insErr } = await supabaseAdmin.from("kognitos_automations").insert({
    automation_id: envId,
    resource_name: null,
    display_name: null,
    description: null,
    org_id: null,
  });
  if (insErr && insErr.code !== "23505") throw insErr;
}
