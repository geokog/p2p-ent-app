import { DOMAIN } from "@/lib/domain.config";

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  DOMAIN.roles.map((r) => [r.value, r.label])
);

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  DOMAIN.statuses.map((s) => [s.value, s.label])
);
