/**
 * For each run in `kognitos_runs` (same pool as the Runs analyzed table), read the
 * stored automation payload and print the resolved **Supplier Invoice** (trimmed;
 * a leading tab before digits, e.g. tab + 5100001841, becomes 5100001841).
 *
 * Uses the same resolution rules as the dashboard (`normalizeKognitosRowForDashboard`).
 *
 * Usage (from project root, requires `.env.local` with Supabase service role):
 *   npx tsx scripts/list-runs-supplier-invoice.ts
 *   npx tsx scripts/list-runs-supplier-invoice.ts --limit 50
 *   npx tsx scripts/list-runs-supplier-invoice.ts --json
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const limit = Math.min(
    10_000,
    Math.max(1, parseInt(arg("--limit") ?? "500", 10) || 500),
  );
  const asJson = hasFlag("--json");

  const { supabaseAdmin } = await import("../lib/supabase");
  const { normalizeKognitosRowForDashboard } = await import(
    "../lib/kognitos/normalize-dashboard-run"
  );

  if (!supabaseAdmin) {
    throw new Error(
      "Configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }

  const { data: rows, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, payload, update_time, create_time, kognitos_automation_id")
    .order("update_time", { ascending: false, nullsFirst: false })
    .order("create_time", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  const list = rows ?? [];

  const automationIds = [
    ...new Set(
      list
        .map((r) => r.kognitos_automation_id as string | null | undefined)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const automationNameById = new Map<string, string>();
  if (automationIds.length > 0) {
    const { data: autos, error: autoErr } = await supabaseAdmin
      .from("kognitos_automations")
      .select("id, display_name")
      .in("id", automationIds);
    if (!autoErr && autos) {
      for (const a of autos) {
        const row = a as { id: string; display_name: string | null };
        automationNameById.set(
          String(row.id),
          row.display_name?.trim() || "",
        );
      }
    }
  }

  const out: { run_id: string; supplier_invoice: string; automation: string }[] =
    [];

  for (const row of list) {
    const autoId = row.kognitos_automation_id as string | null | undefined;
    const normalized = normalizeKognitosRowForDashboard({
      id: String(row.id),
      payload: row.payload,
      update_time:
        typeof row.update_time === "string"
          ? row.update_time
          : row.update_time != null
            ? String(row.update_time)
            : null,
      create_time:
        typeof row.create_time === "string"
          ? row.create_time
          : row.create_time != null
            ? String(row.create_time)
            : null,
      automation_display_name:
        autoId != null ? automationNameById.get(String(autoId)) ?? null : null,
    });
    out.push({
      run_id: String(row.id),
      supplier_invoice: normalized.invoiceNumber,
      automation:
        autoId != null ? automationNameById.get(String(autoId)) ?? "" : "",
    });
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log("run_id\tsupplier_invoice\tautomation");
  for (const r of out) {
    console.log(
      `${r.run_id}\t${r.supplier_invoice}\t${r.automation.replace(/\t/g, " ")}`,
    );
  }
  console.error(`\nRows: ${out.length} (limit ${limit})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
