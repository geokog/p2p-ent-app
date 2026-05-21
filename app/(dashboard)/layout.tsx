"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { canAccessPath, getDefaultPath } from "@/lib/role-permissions";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  Sidebar,
  SidebarProvider,
  useSidebar,
} from "@/components/layout/sidebar";
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
    <SidebarProvider>
      <KognitosSetupGate>
        <DashboardShell>{children}</DashboardShell>
      </KognitosSetupGate>
    </SidebarProvider>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar();
  const sidebarWidth = expanded
    ? SIDEBAR_EXPANDED_WIDTH
    : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <div
      className="min-h-svh bg-app-page-bg"
      style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <Sidebar />
      <div className="transition-[padding-left] duration-200 ease-out lg:pl-[var(--sidebar-w)]">
        <Topbar />
        <main className="p-4 lg:p-6">{children}</main>
      </div>
      <ChatPanel />
    </div>
  );
}
