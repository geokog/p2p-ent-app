"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { canAccessPath, getDefaultPath } from "@/lib/role-permissions";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ChatPanel } from "@/components/ui/chat-panel";
import { KognitosSetupGate } from "@/components/kognitos/kognitos-setup-gate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!canAccessPath(user.role, pathname)) {
      router.replace(getDefaultPath(user.role));
    }
  }, [user, router, pathname]);

  if (!user) {
    return null;
  }

  if (!canAccessPath(user.role, pathname)) {
    return null;
  }

  return (
    <KognitosSetupGate>
      <div className="min-h-svh bg-muted/30">
        <Sidebar />
        <div className="lg:pl-64">
          <Topbar />
          <main className="p-4 lg:p-6">{children}</main>
        </div>
        <ChatPanel />
      </div>
    </KognitosSetupGate>
  );
}
