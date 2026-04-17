"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = { onResolved: () => void };

/**
 * Full-screen gate for admins when automations exist (e.g. env bootstrap) but
 * Kognitos metadata / run sync has not completed yet.
 */
export function AdminKognitosDataBlocking({ onResolved }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kognitos/sync", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(
          json.error === "no_automations_registered"
            ? "No automations are registered yet."
            : (json.message ??
              json.error ??
              `Kognitos sync failed (${res.status})`),
        );
        return;
      }
      const st = await fetch("/api/kognitos/automations/status");
      const status = (await st.json()) as {
        needsKognitosRefresh?: boolean;
      };
      if (status.needsKognitosRefresh) {
        setError(
          "Could not load automation details from Kognitos. Check API credentials and try again.",
        );
        return;
      }
      window.dispatchEvent(new Event("chat-data-changed"));
      onResolved();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg border-border/80 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Sync Kognitos data</CardTitle>
          <CardDescription>
            Run data has not been loaded yet (for example after setting{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              KOGNITOS_AUTOMATION_ID
            </code>{" "}
            in the environment). Refresh now to import runs and load automation
            names for this app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={() => void handleRefresh()}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Refreshing…
              </>
            ) : (
              "Refresh from Kognitos"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
