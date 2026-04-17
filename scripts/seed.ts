/**
 * Seed script: pushes all seed data into Supabase.
 *
 * Usage (from repo root, reads `.env.local`):
 *   npm run seed
 *
 * Or: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed.ts
 *
 * Uses service role key to bypass RLS.
 */

import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

async function upsert(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const { error } = await sb.from(table).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error(`  ERROR seeding ${table}:`, error.message);
  } else {
    console.log(`  ✓ ${table}: ${rows.length} rows`);
  }
}

async function main() {
  console.log("Seeding Supabase...\n");

  const {
    organizations,
    users,
    rules,
    kognitosAutomations,
    kognitosRuns,
    requests,
    documents,
    comments,
    auditEvents,
    notifications,
  } = await import("../lib/seed-data");

  await upsert("organizations", organizations);
  await upsert("users", users);
  await upsert("rules", rules);
  await upsert("kognitos_automations", kognitosAutomations);
  await upsert("kognitos_runs", kognitosRuns);
  await upsert("requests", requests);
  await upsert("documents", documents);
  await upsert("comments", comments);
  await upsert("audit_events", auditEvents);
  await upsert("notifications", notifications);

  console.log("\nDone!");
}

main().catch(console.error);
