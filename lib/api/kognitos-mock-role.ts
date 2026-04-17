import { NextResponse } from "next/server";

/** Template uses client mock auth; API routes accept `x-mock-role` from dashboard fetches. */
export function getMockRole(request: Request): string | null {
  return request.headers.get("x-mock-role");
}

export function requireAdmin(request: Request): NextResponse | null {
  if (getMockRole(request) !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
