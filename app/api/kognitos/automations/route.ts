import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/kognitos-mock-role";
import { getKognitosAutomationDetailsUrl } from "@/lib/kognitos/automation-details-url";
import { getTotalRunsByAutomationShortId } from "@/lib/kognitos/client-core";
import { supabaseAdmin } from "@/lib/supabase";

function kognitosRemoteConfigured(): boolean {
  return !!(
    process.env.KOGNITOS_BASE_URL &&
    (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
    (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
    process.env.KOGNITOS_WORKSPACE_ID
  );
}

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing" },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("kognitos_automations")
    .select(
      "id, automation_id, resource_name, display_name, description, created_at",
    )
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const automations = data ?? [];

  let totalRunsByShortId = new Map<string, number>();
  if (kognitosRemoteConfigured()) {
    try {
      totalRunsByShortId = await getTotalRunsByAutomationShortId();
    } catch {
      totalRunsByShortId = new Map();
    }
  }

  const enriched = automations.map((a) => ({
    ...a,
    total_runs: totalRunsByShortId.get(String(a.automation_id)) ?? 0,
    details_url: getKognitosAutomationDetailsUrl(String(a.automation_id)),
  }));

  return NextResponse.json({ automations: enriched });
}

type RegisterBody = {
  registrations: Array<{
    automation_id: string;
    resource_name?: string | null;
    display_name?: string | null;
    description?: string | null;
  }>;
};

export async function POST(request: Request) {
  const forbidden = requireAdmin(request);
  if (forbidden) return forbidden;

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing" },
      { status: 503 },
    );
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const regs = body.registrations ?? [];
  if (!Array.isArray(regs) || regs.length === 0) {
    return NextResponse.json({ error: "registrations_required" }, { status: 400 });
  }

  const rows = regs.map((r) => ({
    automation_id: String(r.automation_id).trim(),
    resource_name: r.resource_name ?? null,
    display_name: r.display_name ?? null,
    description: r.description ?? null,
    org_id: null as string | null,
  }));

  for (const r of rows) {
    if (!r.automation_id) {
      return NextResponse.json({ error: "invalid_automation_id" }, { status: 400 });
    }
  }

  const inserted: { id: string; automation_id: string }[] = [];
  for (const row of rows) {
    const { data, error } = await supabaseAdmin
      .from("kognitos_automations")
      .insert(row)
      .select("id, automation_id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") continue;
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data) inserted.push(data);
  }

  return NextResponse.json({ ok: true, inserted });
}
