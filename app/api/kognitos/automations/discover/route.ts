import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/kognitos-mock-role";
import { automationShortIdFromResourceName } from "@/lib/kognitos/automation-name";
import { getKognitosAutomationDetailsUrl } from "@/lib/kognitos/automation-details-url";
import { isPublishedAutomationRaw } from "@/lib/kognitos/is-published-automation";
import {
  getTotalRunsByAutomationShortId,
  listAllAutomationsRaw,
} from "@/lib/kognitos/client-core";

export type DiscoverAutomation = {
  automation_id: string;
  resource_name: string;
  display_name: string;
  description: string;
  /** Remote Kognitos run count; 0 means the row cannot be selected. */
  run_count: number;
  /** Kognitos web UI link; null if org/workspace/app origin env is not set. */
  details_url: string | null;
};

export async function POST(request: Request) {
  const forbidden = requireAdmin(request);
  if (forbidden) return forbidden;

  const hasEnv =
    process.env.KOGNITOS_BASE_URL &&
    (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
    (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
    process.env.KOGNITOS_WORKSPACE_ID;

  if (!hasEnv) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }

  try {
    const raw = await listAllAutomationsRaw({
      filter: 'stage = "PUBLISHED"',
    });
    const base: Omit<DiscoverAutomation, "run_count" | "details_url">[] = [];
    for (const a of raw) {
      if (!isPublishedAutomationRaw(a)) continue;
      const name = String(a.name ?? "");
      const shortId = automationShortIdFromResourceName(name);
      if (!shortId) continue;
      const displayName =
        typeof a.display_name === "string" && a.display_name
          ? a.display_name
          : shortId;
      const desc =
        typeof a.description === "string"
          ? a.description
          : typeof a.english_code === "string"
            ? a.english_code
            : "";
      base.push({
        automation_id: shortId,
        resource_name: name,
        display_name: displayName,
        description: desc,
      });
    }

    let runTotals = new Map<string, number>();
    try {
      runTotals = await getTotalRunsByAutomationShortId();
    } catch {
      runTotals = new Map();
    }

    const automations: DiscoverAutomation[] = base.map((item) => ({
      ...item,
      run_count: runTotals.get(item.automation_id) ?? 0,
      details_url: getKognitosAutomationDetailsUrl(item.automation_id),
    }));

    return NextResponse.json({ automations });
  } catch (e) {
    const message = e instanceof Error ? e.message : "discover_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
