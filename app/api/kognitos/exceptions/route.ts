import { NextResponse } from "next/server";

import {
  mapExceptionToSummary,
  type ExceptionSummaryDto,
} from "@/lib/kognitos/exception-view-model";
import {
  listWorkspaceExceptions,
  type WorkspaceExceptionStateFilter,
} from "@/lib/kognitos/workspace-exceptions-api";
import { supabaseAdmin } from "@/lib/supabase";

function kognitosEnvReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY || process.env.KOGNITOS_PAT) &&
      (process.env.KOGNITOS_ORGANIZATION_ID || process.env.KOGNITOS_ORG_ID) &&
      process.env.KOGNITOS_WORKSPACE_ID?.trim(),
  );
}

function parseStateFilter(v: string | null): WorkspaceExceptionStateFilter {
  if (
    v === "pending" ||
    v === "archived" ||
    v === "resolved" ||
    v === "non_resolved"
  ) {
    return v;
  }
  return "pending";
}

export async function GET(request: Request) {
  if (!kognitosEnvReady()) {
    return NextResponse.json(
      { error: "kognitos_env_missing", items: [], nextPageToken: null },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const state = parseStateFilter(url.searchParams.get("state"));
  const pageToken = url.searchParams.get("page_token") ?? undefined;
  const pageSize = Math.min(
    Math.max(Number(url.searchParams.get("page_size") ?? "50") || 50, 1),
    100,
  );

  let raw: Record<string, unknown>;
  try {
    raw = await listWorkspaceExceptions({ state, pageSize, pageToken });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json(
      { error: msg, items: [], nextPageToken: null },
      { status: 502 },
    );
  }

  const list =
    (raw.exceptions as unknown[]) ??
    (raw.exception as unknown[]) ??
    [];
  const nextPageToken =
    (typeof raw.next_page_token === "string" && raw.next_page_token) ||
    (typeof raw.nextPageToken === "string" && raw.nextPageToken) ||
    null;

  const automationDisplayNameByAutomationId = new Map<string, string>();
  if (supabaseAdmin) {
    const { data: autos } = await supabaseAdmin
      .from("kognitos_automations")
      .select("automation_id, display_name");
    for (const a of autos ?? []) {
      const row = a as { automation_id?: string; display_name?: string };
      const ext = String(row.automation_id ?? "").trim();
      const name = String(row.display_name ?? "").trim();
      if (ext && name) automationDisplayNameByAutomationId.set(ext, name);
    }
  }

  const items: ExceptionSummaryDto[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const m = mapExceptionToSummary(
      row as Record<string, unknown>,
      automationDisplayNameByAutomationId,
    );
    if (m) items.push(m);
  }

  return NextResponse.json({ items, nextPageToken, state });
}
