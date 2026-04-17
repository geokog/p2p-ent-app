import { NextResponse } from "next/server";

import { runKognitosRefresh } from "@/lib/kognitos/sync";

export async function POST() {
  const hasEnv =
    process.env.KOGNITOS_BASE_URL &&
    (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
    (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
    process.env.KOGNITOS_WORKSPACE_ID;

  if (!hasEnv) {
    return NextResponse.json(
      {
        ok: false,
        error: "kognitos_env_missing",
        message:
          "Configure KOGNITOS_BASE_URL, KOGNITOS_API_KEY (or KOGNITOS_PAT), organization, and workspace. Register automations in-app (or set KOGNITOS_AUTOMATION_ID for single-automation bootstrap).",
      },
      { status: 503 },
    );
  }

  try {
    const result = await runKognitosRefresh();
    if (!result.ok) {
      return NextResponse.json(result, { status: 503 });
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
