"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AdminKognitosDataBlocking } from "./admin-kognitos-data-blocking";
import { NonAdminKognitosSetupBlocking } from "./non-admin-kognitos-setup-blocking";

type GateView =
  | { type: "loading" }
  | { type: "ok" }
  | { type: "redirecting" }
  | { type: "admin_sync" }
  | { type: "non_admin"; variant: "no_automation" | "needs_sync" };

/**
 * Blocks the dashboard until Kognitos automations are registered and (when
 * using env bootstrap) an initial sync has populated metadata and run data.
 */
export function KognitosSetupGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [view, setView] = useState<GateView>({ type: "loading" });

  const evaluate = useCallback(async (opts?: { silent?: boolean }) => {
    await Promise.resolve();
    if (!user) {
      setView({ type: "ok" });
      return;
    }
    if (!opts?.silent) {
      setView({ type: "loading" });
    }
    try {
      const res = await fetch("/api/kognitos/automations/status");
      const json = (await res.json()) as {
        setupComplete?: boolean;
        needsKognitosRefresh?: boolean;
      };

      const setupComplete = Boolean(json.setupComplete);
      const needsKognitosRefresh = Boolean(json.needsKognitosRefresh);

      if (!setupComplete) {
        if (user.role === "admin") {
          if (pathname?.startsWith("/onboarding/kognitos")) {
            setView({ type: "ok" });
          } else {
            router.replace("/onboarding/kognitos");
            setView({ type: "redirecting" });
          }
        } else {
          setView({ type: "non_admin", variant: "no_automation" });
        }
        return;
      }

      if (needsKognitosRefresh) {
        if (user.role === "admin") {
          setView({ type: "admin_sync" });
        } else {
          setView({ type: "non_admin", variant: "needs_sync" });
        }
        return;
      }

      setView({ type: "ok" });
    } catch {
      setView({ type: "ok" });
    }
  }, [user, pathname, router]);

  useEffect(() => {
    const t = window.setTimeout(() => void evaluate(), 0);
    return () => clearTimeout(t);
  }, [evaluate]);

  if (!user) {
    return <>{children}</>;
  }

  if (view.type === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (view.type === "redirecting") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 text-muted-foreground">
        Redirecting…
      </div>
    );
  }

  if (view.type === "admin_sync") {
    return (
      <AdminKognitosDataBlocking
        onResolved={() => void evaluate({ silent: true })}
      />
    );
  }

  if (view.type === "non_admin") {
    return (
      <NonAdminKognitosSetupBlocking
        variant={view.variant}
        onRecheck={() => void evaluate()}
      />
    );
  }

  return <>{children}</>;
}
