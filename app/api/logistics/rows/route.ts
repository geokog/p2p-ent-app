import { NextResponse } from "next/server";

import { requireMockRole } from "@/lib/api/kognitos-mock-role";
import { parseLogisticsRowsJson } from "@/lib/logistics/parse-logistics-rows";
import { supabaseAdmin } from "@/lib/supabase";

const GRID_ID = "default";

export async function GET(request: Request) {
  const forbidden = requireMockRole(request);
  if (forbidden) return forbidden;

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing", rows: null },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("logistics_grid_state")
    .select("rows, updated_at")
    .eq("id", GRID_ID)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message, rows: null },
      { status: 502 },
    );
  }

  if (!data?.rows) {
    return NextResponse.json({ rows: null, updated_at: null });
  }

  const parsed = parseLogisticsRowsJson(data.rows);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, rows: null },
      { status: 502 },
    );
  }

  return NextResponse.json({
    rows: parsed.rows,
    updated_at: data.updated_at ?? null,
  });
}

export async function PUT(request: Request) {
  const forbidden = requireMockRole(request);
  if (forbidden) return forbidden;

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawRows =
    body && typeof body === "object" && "rows" in body
      ? (body as { rows: unknown }).rows
      : undefined;

  const parsed = parseLogisticsRowsJson(rawRows);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("logistics_grid_state").upsert(
    {
      id: GRID_ID,
      rows: parsed.rows,
      updated_at: now,
    },
    { onConflict: "id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, updated_at: now });
}
