import { NextResponse } from "next/server";

import { KognitosApiError } from "@/lib/kognitos/client-core";
import { listWorkspacesInOrg } from "@/lib/kognitos/developer-listing";

function kognitosCredsReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY?.trim() ||
        process.env.KOGNITOS_PAT?.trim()),
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  if (!kognitosCredsReady()) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }
  const { orgId } = await context.params;
  const trimmed = decodeURIComponent(orgId ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "missing_org_id" }, { status: 400 });
  }
  try {
    const workspaces = await listWorkspacesInOrg(trimmed);
    return NextResponse.json({ workspaces });
  } catch (e) {
    const status = e instanceof KognitosApiError ? e.status : 502;
    const message = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: message }, { status });
  }
}
