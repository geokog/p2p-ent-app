import { NextResponse } from "next/server";

import { KognitosApiError } from "@/lib/kognitos/client-core";
import { getAutomationCode } from "@/lib/kognitos/developer-listing";

function kognitosCredsReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY?.trim() ||
        process.env.KOGNITOS_PAT?.trim()),
  );
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      orgId: string;
      workspaceId: string;
      automationId: string;
    }>;
  },
) {
  if (!kognitosCredsReady()) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }
  const { orgId, workspaceId, automationId } = await context.params;
  const org = decodeURIComponent(orgId ?? "").trim();
  const ws = decodeURIComponent(workspaceId ?? "").trim();
  const auto = decodeURIComponent(automationId ?? "").trim();
  if (!org || !ws || !auto) {
    return NextResponse.json(
      { error: "missing_org_workspace_or_automation" },
      { status: 400 },
    );
  }
  try {
    const automation = await getAutomationCode(org, ws, auto);
    return NextResponse.json({ automation });
  } catch (e) {
    const status = e instanceof KognitosApiError ? e.status : 502;
    const message = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: message }, { status });
  }
}
