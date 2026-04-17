import { NextResponse } from "next/server";

import { mapRunFromApiJson } from "@/lib/kognitos/map-run";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing" },
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
    return NextResponse.json({ run: null }, { status: 404 });
  }

  const run = mapRunFromApiJson(data.payload as Record<string, unknown>);
  return NextResponse.json({ run });
}
