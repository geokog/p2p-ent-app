import { NextResponse } from "next/server";

import { ensureAutomationFromEnv } from "@/lib/kognitos/ensure-automation-from-env";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Returns whether Kognitos automations are registered (after optional env bootstrap).
 */
export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      {
        setupComplete: false,
        needsKognitosRefresh: false,
        error: "supabase_admin_missing",
      },
      { status: 503 },
    );
  }

  try {
    await ensureAutomationFromEnv();
    const [registered, stubs] = await Promise.all([
      supabaseAdmin
        .from("kognitos_automations")
        .select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("kognitos_automations")
        .select("*", { count: "exact", head: true })
        .is("resource_name", null)
        .is("display_name", null),
    ]);
    if (registered.error) {
      return NextResponse.json(
        { error: registered.error.message },
        { status: 500 },
      );
    }
    if (stubs.error) {
      return NextResponse.json({ error: stubs.error.message }, { status: 500 });
    }
    const setupComplete = (registered.count ?? 0) > 0;
    /** Env-bootstrap rows (and any unfetched metadata) still need a Kognitos refresh. */
    const needsKognitosRefresh = (stubs.count ?? 0) > 0;
    return NextResponse.json({ setupComplete, needsKognitosRefresh });
  } catch (e) {
    const message = e instanceof Error ? e.message : "status_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
