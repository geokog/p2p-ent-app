import { NextResponse } from "next/server";

import { KognitosApiError } from "@/lib/kognitos/client-core";
import {
  listAutomationsInWorkspace,
  type AutomationStageFilter,
} from "@/lib/kognitos/developer-listing";

function kognitosCredsReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY?.trim() ||
        process.env.KOGNITOS_PAT?.trim()),
  );
}

function parseStage(raw: string | null): AutomationStageFilter {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "published" || normalized === "draft") return normalized;
  return "all";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ orgId: string; workspaceId: string }> },
) {
  if (!kognitosCredsReady()) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }
  const { orgId, workspaceId } = await context.params;
  const org = decodeURIComponent(orgId ?? "").trim();
  const ws = decodeURIComponent(workspaceId ?? "").trim();
  if (!org || !ws) {
    return NextResponse.json(
      { error: "missing_org_or_workspace" },
      { status: 400 },
    );
  }
  const url = new URL(request.url);
  const stage = parseStage(url.searchParams.get("stage"));
  const showDeleted = url.searchParams.get("show_deleted") === "true";
  try {
    const automations = await listAutomationsInWorkspace(org, ws, {
      stage,
      showDeleted,
    });
    return NextResponse.json({ automations, stage, showDeleted });
  } catch (e) {
    const status = e instanceof KognitosApiError ? e.status : 502;
    const message = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: message }, { status });
  }
}
