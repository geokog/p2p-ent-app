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
  ChevronLeft,
  ChevronRight,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

type SidebarNavProps = {
  /** Desktop rail: when true with `onToggleCollapsed`, nav shows icons only. */
  collapsed?: boolean;
  /** When set, show collapse/expand control (desktop fixed sidebar only). */
  onToggleCollapsed?: () => void;
};

function SidebarNav({ collapsed = false, onToggleCollapsed }: SidebarNavProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const visibleItems = DOMAIN.navItems.filter((item) => {
    if (item.roles && user && !item.roles.includes(user.role)) return false;
    if (user && !canAccessPath(user.role, item.href)) return false;
    return true;
  });

  const roleConfig = user ? getRoleConfig(user.role) : undefined;
  const railCollapsed = Boolean(onToggleCollapsed && collapsed);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        {onToggleCollapsed ? (
          railCollapsed ? (
            <div className="flex shrink-0 flex-col items-center gap-2 border-b border-sidebar-border px-1 py-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-9 shrink-0 text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    onClick={onToggleCollapsed}
                    aria-expanded={false}
                    aria-label="Expand navigation menu"
                  >
                    <ChevronRight className="size-5" strokeWidth={2} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand menu</TooltipContent>
              </Tooltip>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-primary-foreground">
                <LogoIcon className="size-4" />
              </div>
            </div>
          ) : (
            <div className="flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border pl-2 pr-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-9 shrink-0 text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    onClick={onToggleCollapsed}
                    aria-expanded
                    aria-label="Collapse navigation menu"
                  >
                    <ChevronLeft className="size-5" strokeWidth={2} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Collapse menu</TooltipContent>
              </Tooltip>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-primary-foreground">
                <LogoIcon className="size-4" />
              </div>
              <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-normal">
                {DOMAIN.appName}
              </span>
            </div>
          )
        ) : (
          <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand text-primary-foreground">
              <LogoIcon className="size-4" />
            </div>
            <span className="text-base font-semibold tracking-normal">
              {DOMAIN.appName}
            </span>
          </div>
        )}

        <nav
          className={cn(
            "min-h-0 flex-1 space-y-0.5 overflow-y-auto py-4",
            railCollapsed ? "px-1.5" : "px-3",
          )}
        >
          {visibleItems.map((item) => {
            const Icon = ICON_MAP[item.icon] ?? Layers;
            const active = isActive(pathname, item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
                  railCollapsed
                    ? "justify-center px-0"
                    : "gap-3 px-3",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                {!railCollapsed ? item.label : null}
              </Link>
            );

            if (!railCollapsed) return link;

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {user && (
          <div
            className={cn(
              "shrink-0 border-t border-sidebar-border",
              railCollapsed ? "flex justify-center p-2" : "p-4",
            )}
          >
            {railCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    <Avatar className="size-9 shrink-0">
                      <AvatarFallback className="bg-brand/20 text-xs font-medium">
                        {getInitials(user.full_name)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[220px]">
                  <p className="font-medium">{user.full_name}</p>
                  <p className="text-muted-foreground text-xs">
                    {roleConfig?.label ?? user.role}
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-3">
                <Avatar className="size-9 shrink-0">
                  <AvatarFallback className="bg-brand/20 text-xs font-medium">
                    {getInitials(user.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.full_name}</p>
                  <Badge variant="secondary" className="mt-0.5 text-[10px]">
                    {roleConfig?.label ?? user.role}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 hidden h-full transition-[width] duration-200 ease-out lg:block",
        collapsed ? "w-[4.5rem]" : "w-64",
      )}
    >
      <SidebarNav
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
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
