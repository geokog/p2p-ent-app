import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase";

/**
 * Returns the raw `kognitos_runs.payload` JSON for a run (ListRuns/GetRun shape).
 * Used by the UI to show full automation output (e.g. markdown validation report).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing", payload: null },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("payload")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.payload) {
    return NextResponse.json({ payload: null }, { status: 404 });
  }

  return NextResponse.json({ payload: data.payload });
}
