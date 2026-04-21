import { NextResponse } from "next/server";

import type { UserRole } from "@/lib/types";

/** Template uses client mock auth; API routes accept `x-mock-role` from dashboard fetches. */
export function getMockRole(request: Request): string | null {
  return request.headers.get("x-mock-role");
}

const MOCK_ROLES = new Set<UserRole>([
  "requester",
  "reviewer",
  "manager",
  "admin",
]);

/** Any logged-in dashboard role (header present and known). */
export function requireMockRole(request: Request): NextResponse | null {
  const r = getMockRole(request);
  if (!r || !MOCK_ROLES.has(r as UserRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export function requireAdmin(request: Request): NextResponse | null {
  if (getMockRole(request) !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
