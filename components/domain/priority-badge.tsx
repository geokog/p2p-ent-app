"use client";

import { DOMAIN } from "@/lib/domain.config";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

export function PriorityBadge({ priority }: { priority: string }) {
  const config = DOMAIN.priorities.find((p) => p.value === priority);
  const label = config?.label ?? priority;

  if (priority === "urgent") {
    return (
      <Badge variant="destructive" className="gap-1">
        <Zap className="size-3 fill-current" />
        {label}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-muted-foreground">
      {label}
    </Badge>
  );
}
