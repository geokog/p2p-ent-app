/**
 * Read automation metadata and recent run payloads from Kognitos using
 * KOGNITOS_BASE_URL + KOGNITOS_API_KEY (or PAT) + org/workspace from env.
 *
 * Usage (from project root):
 *   npx tsx scripts/kognitos-read-automation-output.ts
 *   npx tsx scripts/kognitos-read-automation-output.ts --automation tr11jt5jBCZsvPlEvPs7D
 *   npx tsx scripts/kognitos-read-automation-output.ts --org WSnn3S9kmdEGSEl2NRAzC --workspace zLUS9C5wvG6XZQLLrYMGO --automation tr11jt5jBCZsvPlEvPs7D --runs 2
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

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function kognitosFetch(path: string): Promise<unknown> {
  const base = env("KOGNITOS_BASE_URL").replace(/\/$/, "");
  const token = process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT;
  if (!token) throw new Error("Set KOGNITOS_API_KEY or KOGNITOS_PAT");
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kognitos ${res.status} ${path}\n${text.slice(0, 2000)}`);
  }
  return text ? JSON.parse(text) : {};
}

function shortRunIdFromName(name: string): string {
  const parts = name.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? name;
}

async function main() {
  const org =
    arg("--org") ||
    process.env.KOGNITOS_ORGANIZATION_ID ||
    process.env.KOGNITOS_ORG_ID ||
    "";
  const ws = arg("--workspace") || process.env.KOGNITOS_WORKSPACE_ID || "";
  const automation =
    arg("--automation") || process.env.KOGNITOS_AUTOMATION_ID || "";
  const runCount = Math.min(
    10,
    Math.max(1, parseInt(arg("--runs") ?? "3", 10) || 3),
  );

  if (!org || !ws) {
    throw new Error(
      "Set KOGNITOS_ORGANIZATION_ID (or KOGNITOS_ORG_ID) and KOGNITOS_WORKSPACE_ID, or pass --org and --workspace",
    );
  }
  if (!automation) {
    throw new Error(
      "Pass --automation <id> or set KOGNITOS_AUTOMATION_ID in .env.local",
    );
  }

  const enc = encodeURIComponent;
  const autoPath = `/api/v1/organizations/${enc(org)}/workspaces/${enc(ws)}/automations/${enc(automation)}`;
  const runsPath = `${autoPath}/runs?page_size=${runCount}`;

  console.log("=== GET Automation (metadata) ===\n");
  const automationJson = (await kognitosFetch(autoPath)) as Record<
    string,
    unknown
  >;
  console.log(
    JSON.stringify(
      {
        name: automationJson.name,
        display_name: automationJson.display_name,
        description: automationJson.description,
        english_code:
          typeof automationJson.english_code === "string"
            ? automationJson.english_code.slice(0, 200)
            : undefined,
        input_specs: automationJson.input_specs,
      },
      null,
      2,
    ),
  );

  console.log("\n=== GET Runs (raw — includes user_inputs / state / outputs) ===\n");
  const list = (await kognitosFetch(runsPath)) as {
    runs?: Record<string, unknown>[];
  };
  const runs = list.runs ?? [];
  if (runs.length === 0) {
    console.log("(no runs returned)");
    return;
  }

  for (const run of runs) {
    const name = String(run.name ?? "");
    const id = shortRunIdFromName(name);
    const ui = (run.userInputs ?? run.user_inputs) as Record<
      string,
      unknown
    > | null;
    const state = run.state as Record<string, unknown> | undefined;
    const completed = state?.completed as Record<string, unknown> | undefined;
    const outputs = completed?.outputs;

    console.log("--- run:", id, "---");
    console.log(
      JSON.stringify(
        {
          name: run.name,
          userInputs: ui ?? run.userInputs ?? run.user_inputs,
          outputs: outputs ?? null,
          stage: run.stage,
        },
        null,
        2,
      ),
    );
    console.log("");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
