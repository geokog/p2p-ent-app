"use client";

import { useState, useEffect } from "react";
import { Circle } from "lucide-react";
import { format } from "date-fns";
import { getUserById } from "@/lib/api";
import type { AuditEvent, User } from "@/lib/types";

function formatAction(action: string): string {
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renderDetails(details: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === "from" && details.to) {
      parts.push(`${String(value)} \u2192 ${String(details.to)}`);
      break;
    }
    if (key === "to") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key.replace(/_/g, " ")}: ${String(value)}`);
    }
  }
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}

export function TimelineEvent({ event }: { event: AuditEvent }) {
  const [actor, setActor] = useState<User | null>(null);

  useEffect(() => {
    if (event.actor_id) {
      getUserById(event.actor_id).then((u) => setActor(u ?? null));
    }
  }, [event.actor_id]);

  const detailStr = renderDetails(event.details);

  return (
    <div className="relative flex gap-4 pb-8 last:pb-0">
      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border last:hidden" />

      <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background">
        <Circle className="size-4 text-muted-foreground" />
      </div>

      <div className="flex-1 space-y-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{formatAction(event.action)}</span>
        </div>

        {detailStr && (
          <p className="text-xs text-muted-foreground">{detailStr}</p>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <time>{format(new Date(event.created_at), "MMM d, yyyy 'at' h:mm a")}</time>
          {actor && <span>&middot; {actor.full_name}</span>}
        </div>
      </div>
    </div>
  );
}
