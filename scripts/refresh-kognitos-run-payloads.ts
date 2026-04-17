/**
 * Re-fetch every stored run from Kognitos GET Run and refresh `kognitos_runs.payload` + `kognitos_run_inputs`.
 *
 * Usage (from project root):
 *   npm run refresh:run-payloads
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { refreshAllRunPayloadsFromKognitos } = await import(
    "../lib/kognitos/refresh-run-payloads"
  );
  const result = await refreshAllRunPayloadsFromKognitos();
  if (!result.ok) {
    console.error(result.error ?? "failed");
    process.exit(1);
  }
  console.log(`Updated ${result.updated}, failed ${result.failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
