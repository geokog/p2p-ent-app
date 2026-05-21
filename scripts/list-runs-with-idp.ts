/**
 * Smoke helper for the document-preview test bed: scan `kognitos_runs` and
 * print the most recent rows that actually have IDP highlights (so we can
 * pick a real runId to drive the new viewer with).
 *
 *   npx tsx scripts/list-runs-with-idp.ts            # top 10
 *   npx tsx scripts/list-runs-with-idp.ts --limit 30 # scan more rows
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

function arg(flag: string, def: number): number {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) {
    const n = parseInt(process.argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return def;
}

async function main() {
  const scan = arg("--limit", 200);
  const print = arg("--print", 10);

  const { supabaseAdmin } = await import("../lib/supabase");
  const { parseFieldHighlights } = await import("../lib/doc-preview-test/idp-parser");
  if (!supabaseAdmin) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }

  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, payload, update_time, create_time")
    .order("update_time", { ascending: false, nullsFirst: false })
    .order("create_time", { ascending: false })
    .limit(scan);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    payload: unknown;
    update_time: string | null;
    create_time: string | null;
  }>;

  const winners: Array<{ id: string; count: number; pages: number; whenIso: string | null }> = [];
  for (const row of rows) {
    const { highlights } = parseFieldHighlights(row.payload);
    if (highlights.length === 0) continue;
    const pages = new Set(highlights.map((h) => h.pageNumber)).size;
    winners.push({
      id: row.id,
      count: highlights.length,
      pages,
      whenIso: row.update_time ?? row.create_time,
    });
  }
  winners.sort((a, b) => b.pages - a.pages || b.count - a.count);
  winners.length = Math.min(winners.length, print);

  console.log(JSON.stringify(winners, null, 2));
  console.error(`\nScanned ${rows.length} rows, returned ${winners.length} runs with IDP highlights.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
