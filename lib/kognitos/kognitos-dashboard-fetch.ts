import type { UserRole } from "@/lib/types";

/** Attach mock role header for Kognitos dashboard API routes. */
export function kognitosDashboardFetch(
  input: RequestInfo | URL,
  init: RequestInit & { role?: UserRole } = {},
): Promise<Response> {
  const { role, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (role) headers.set("x-mock-role", role);
  return fetch(input, { ...rest, headers });
}
