"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  BarChart3,
  BookOpen,
  Bell,
  Settings,
  Store,
  Truck,
  LifeBuoy,
  Layers,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { DOMAIN, getRoleConfig } from "@/lib/domain.config";
import { canAccessPath } from "@/lib/role-permissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  BarChart3,
  BookOpen,
  Bell,
  Settings,
  Store,
  Truck,
  LifeBuoy,
  Layers,
};

const LogoIcon = ICON_MAP[DOMAIN.appLogo] ?? Layers;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SidebarNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  const visibleItems = DOMAIN.navItems.filter((item) => {
    if (item.roles && user && !item.roles.includes(user.role)) return false;
    if (user && !canAccessPath(user.role, item.href)) return false;
    return true;
  });

  const roleConfig = user ? getRoleConfig(user.role) : undefined;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-sidebar-border">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brand text-primary-foreground">
          <LogoIcon className="size-4" />
        </div>
        <span className="text-base font-semibold tracking-normal">
          {DOMAIN.appName}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {visibleItems.map((item) => {
          const Icon = ICON_MAP[item.icon] ?? Layers;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-9 shrink-0">
              <AvatarFallback className="bg-brand/20 text-xs font-medium">
                {getInitials(user.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {user.full_name}
              </p>
              <Badge
                variant="secondary"
                className="mt-0.5 text-[10px]"
              >
                {roleConfig?.label ?? user.role}
              </Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-full w-64 lg:block">
      <SidebarNav />
    </aside>
  );
}

export function MobileSidebar() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu className="size-5" />
          <span className="sr-only">Open sidebar</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarNav />
      </SheetContent>
    </Sheet>
  );
}
