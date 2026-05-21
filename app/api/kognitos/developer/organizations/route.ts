import { NextResponse } from "next/server";

import { KognitosApiError } from "@/lib/kognitos/client-core";
import { listOrganizationsForCurrentUser } from "@/lib/kognitos/developer-listing";

function kognitosCredsReady(): boolean {
  return Boolean(
    process.env.KOGNITOS_BASE_URL?.trim() &&
      (process.env.KOGNITOS_API_KEY?.trim() ||
        process.env.KOGNITOS_PAT?.trim()),
  );
}

export async function GET() {
  if (!kognitosCredsReady()) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }
  try {
    const organizations = await listOrganizationsForCurrentUser();
    return NextResponse.json({ organizations });
  } catch (e) {
    const status = e instanceof KognitosApiError ? e.status : 502;
    const message = e instanceof Error ? e.message : "kognitos_request_failed";
    return NextResponse.json({ error: message }, { status });
  }
}
