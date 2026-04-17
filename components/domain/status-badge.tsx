"use client";

import { getStatusConfig } from "@/lib/domain.config";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const config = getStatusConfig(status);
  if (!config) {
    return <Badge variant="outline">{status}</Badge>;
  }
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function getStatusLabel(status: string): string {
  return getStatusConfig(status)?.label ?? status;
}
