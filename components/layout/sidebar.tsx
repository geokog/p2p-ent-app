"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronRight,
  ClipboardCheck,
  Code2,
  FileText,
  FlaskConical,
  Grid2x2,
  List,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Truck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { DOMAIN, getRoleConfig, type NavItem } from "@/lib/domain.config";
import { canAccessPath } from "@/lib/role-permissions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const ICON_MAP: Record<string, LucideIcon> = {
  Grid2x2,
  Users,
  TriangleAlert,
  Sparkles,
  FlaskConical,
  FileText,
  Truck,
  List,
  ClipboardCheck,
  Bell,
  Settings,
  Code2,
};

const BOTTOM_ITEM_HREFS = new Set(["/notifications", "/settings"]);

const SIDEBAR_BG = "rgba(248, 248, 250, 0.95)";
const SIDEBAR_BG_SOLID = "#f8f8fa";
const SIDEBAR_BORDER = "0.5px solid rgba(0,0,0,0.08)";
const ITEM_DEFAULT_COLOR = "#aeaeb2";
const ITEM_HOVER_COLOR = "#6e6e73";
const ITEM_HOVER_BG = "rgba(0,0,0,0.05)";
const ITEM_ACTIVE_COLOR = "#0071e3";
const ITEM_ACTIVE_BG = "rgba(0,113,227,0.09)";

export const SIDEBAR_COLLAPSED_WIDTH = 56;
export const SIDEBAR_EXPANDED_WIDTH = 220;
const SIDEBAR_STORAGE_KEY = "sidebar-expanded";

type SidebarContextValue = {
  expanded: boolean;
  toggle: () => void;
  setExpanded: (expanded: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | undefined>(
  undefined,
);

// Module-level store so the persisted preference survives across mounts and is
// shared between any sidebar consumers without prop drilling. We use
// useSyncExternalStore (React 19-friendly) rather than setState-in-effect.
let sidebarMemoryState: boolean | null = null;
const sidebarListeners = new Set<() => void>();

function readSidebarState(): boolean {
  if (sidebarMemoryState !== null) return sidebarMemoryState;
  if (typeof window === "undefined") {
    sidebarMemoryState = false;
    return false;
  }
  try {
    sidebarMemoryState =
      window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    sidebarMemoryState = false;
  }
  return sidebarMemoryState;
}

function writeSidebarState(next: boolean) {
  sidebarMemoryState = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }
  sidebarListeners.forEach((listener) => listener());
}

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  return () => {
    sidebarListeners.delete(listener);
  };
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const expanded = useSyncExternalStore(
    subscribeSidebar,
    readSidebarState,
    () => false,
  );

  const setExpanded = useCallback((next: boolean) => {
    writeSidebarState(next);
  }, []);

  const toggle = useCallback(() => {
    writeSidebarState(!readSidebarState());
  }, []);

  const value = useMemo(
    () => ({ expanded, toggle, setExpanded }),
    [expanded, toggle, setExpanded],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    return {
      expanded: false,
      toggle: () => {},
      setExpanded: () => {},
    };
  }
  return ctx;
}

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

function BrandMark() {
  return (
    <div
      className="grid grid-cols-2 gap-[3px]"
      style={{ width: 28, height: 28 }}
      aria-hidden
    >
      {[0.9, 0.55, 0.55, 0.25].map((opacity, i) => (
        <div
          key={i}
          style={{
            background: `rgba(0, 113, 227, ${opacity})`,
            borderRadius: 3.5,
          }}
        />
      ))}
    </div>
  );
}

type SidebarItemProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  showPip?: boolean;
  expanded: boolean;
  /** Render with a small left indent so the icon visually nests under a group header. */
  nested?: boolean;
};

function SidebarItem({
  href,
  label,
  icon: Icon,
  active,
  showPip,
  expanded,
  nested,
}: SidebarItemProps) {
  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      data-sidebar-tip={expanded ? undefined : ""}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-[10px]",
        "transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 focus-visible:ring-offset-0",
        expanded
          ? cn("w-full justify-start gap-3 px-2.5", nested && "ml-3")
          : "justify-center",
      )}
      style={{
        width: expanded ? (nested ? "calc(100% - 0.75rem)" : "100%") : 38,
        height: 38,
        color: active ? ITEM_ACTIVE_COLOR : ITEM_DEFAULT_COLOR,
        background: active ? ITEM_ACTIVE_BG : "transparent",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.color = ITEM_HOVER_COLOR;
        e.currentTarget.style.background = ITEM_HOVER_BG;
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.color = ITEM_DEFAULT_COLOR;
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span className="relative flex shrink-0 items-center justify-center" style={{ width: 20, height: 20 }}>
        <Icon size={16} strokeWidth={1.75} fill="none" />
        {showPip && !expanded ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 7,
              height: 7,
              borderRadius: 9999,
              background: "#ff3b30",
              border: `1.5px solid ${SIDEBAR_BG_SOLID}`,
            }}
          />
        ) : null}
      </span>
      {expanded ? (
        <span
          className="flex-1 truncate text-[13px] font-medium"
          style={{ color: "inherit" }}
        >
          {label}
        </span>
      ) : null}
      {showPip && expanded ? (
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 9999,
            background: "#ff3b30",
            flexShrink: 0,
          }}
        />
      ) : null}
    </Link>
  );
}

type SidebarGroupHeaderProps = {
  label: string;
  icon: LucideIcon;
  expanded: boolean;
  open: boolean;
  /** True when one of the children in this group is the active page. */
  childActive: boolean;
  onToggle: () => void;
};

/**
 * Clickable section header for a nav group whose `href` is omitted in
 * `domain.config.ts` (a placeholder that exists only to host children).
 *
 * Visually matches {@link SidebarItem} so the group looks like a peer in the
 * navigation list. A `ChevronRight` (rotated when {@link open}) indicates the
 * group can be opened/closed; clicking the row toggles it. Children are
 * rendered separately by {@link SidebarRail} based on the same `open` flag.
 *
 * In collapsed (icon-only) mode the chevron is omitted because there's no
 * room for it; the icon still acts as a toggle. The hover-to-expand behavior
 * on `<Sidebar>` means users almost always interact with this header in the
 * expanded form anyway.
 */
function SidebarGroupHeader({
  label,
  icon: Icon,
  expanded,
  open,
  childActive,
  onToggle,
}: SidebarGroupHeaderProps) {
  const active = childActive;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? undefined : label}
      data-sidebar-tip={expanded ? undefined : ""}
      aria-label={label}
      aria-expanded={open}
      className={cn(
        "group relative flex items-center rounded-[10px]",
        "transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 focus-visible:ring-offset-0",
        expanded ? "w-full justify-start gap-3 px-2.5" : "justify-center",
      )}
      style={{
        width: expanded ? "100%" : 38,
        height: 38,
        color: active ? ITEM_ACTIVE_COLOR : ITEM_DEFAULT_COLOR,
        background: active ? ITEM_ACTIVE_BG : "transparent",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.color = ITEM_HOVER_COLOR;
        e.currentTarget.style.background = ITEM_HOVER_BG;
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.color = ITEM_DEFAULT_COLOR;
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: 20, height: 20 }}
      >
        <Icon size={16} strokeWidth={1.75} fill="none" />
      </span>
      {expanded ? (
        <>
          <span
            className="flex-1 truncate text-left text-[13px] font-medium"
            style={{ color: "inherit" }}
          >
            {label}
          </span>
          <ChevronRight
            size={14}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "shrink-0 transition-transform duration-150",
              open ? "rotate-90" : "rotate-0",
            )}
          />
        </>
      ) : null}
    </button>
  );
}

type CollapseToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

function CollapseToggle({ expanded, onToggle }: CollapseToggleProps) {
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen;
  const label = expanded ? "Collapse sidebar" : "Expand sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[8px]",
        "transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 focus-visible:ring-offset-0",
      )}
      style={{
        width: 28,
        height: 28,
        color: ITEM_DEFAULT_COLOR,
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = ITEM_HOVER_COLOR;
        e.currentTarget.style.background = ITEM_HOVER_BG;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = ITEM_DEFAULT_COLOR;
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

type SidebarRailProps = {
  expanded?: boolean;
  onToggle?: () => void;
  /** When false, the collapse/expand toggle is hidden (e.g. on mobile sheet). */
  showToggle?: boolean;
};

export function SidebarRail({
  expanded: expandedProp,
  onToggle,
  showToggle = true,
}: SidebarRailProps = {}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const ctx = useSidebar();

  const expanded = expandedProp ?? ctx.expanded;
  const toggle = onToggle ?? ctx.toggle;

  /**
   * Per-group disclosure state. Default is closed (empty record); flipping
   * an entry to `true` opens that group's children. Lives at the rail level
   * so it survives sidebar collapse/expand and hover transitions, but resets
   * on full reload — which matches the requirement "By default, these sub
   * pages should be collapsed."
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isItemVisible = (item: NavItem): boolean => {
    if (item.roles && user && !item.roles.includes(user.role)) return false;
    if (item.href && user && !canAccessPath(user.role, item.href)) return false;
    return true;
  };

  type RenderableEntry =
    | { kind: "leaf"; item: NavItem }
    | { kind: "group"; item: NavItem; children: NavItem[] };

  const visibleEntries: RenderableEntry[] = (
    DOMAIN.navItems as readonly NavItem[]
  ).flatMap((item): RenderableEntry[] => {
    // Group placeholder (no href, only exists to host children).
    if (!item.href) {
      if (item.roles && user && !item.roles.includes(user.role)) return [];
      const visibleChildren = (item.children ?? []).filter(isItemVisible);
      if (visibleChildren.length === 0) return [];
      return [{ kind: "group", item, children: visibleChildren }];
    }
    if (!isItemVisible(item)) return [];
    return [{ kind: "leaf", item }];
  });

  const topEntries = visibleEntries.filter((entry) => {
    if (entry.kind === "group") return true; // groups stay above the bottom rail
    return !BOTTOM_ITEM_HREFS.has(entry.item.href ?? "");
  });
  const bottomEntries = visibleEntries.filter(
    (entry) =>
      entry.kind === "leaf" && BOTTOM_ITEM_HREFS.has(entry.item.href ?? ""),
  );

  const renderLeaf = (item: NavItem, opts?: { nested?: boolean }) => {
    const Icon = ICON_MAP[item.icon] ?? List;
    const href = item.href ?? "";
    const active = isActive(pathname, href);
    return (
      <SidebarItem
        key={href || item.label}
        href={href}
        label={item.label}
        icon={Icon}
        active={active}
        expanded={expanded}
        nested={opts?.nested}
        showPip={
          href === "/exception-handling" || href === "/exception-handling-v2"
        }
      />
    );
  };

  const roleConfig = user ? getRoleConfig(user.role) : undefined;

  const width = expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <div
      className="flex h-full min-h-0 flex-col transition-[width] duration-200 ease-out"
      style={{
        width,
        background: SIDEBAR_BG,
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderRight: SIDEBAR_BORDER,
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center",
          expanded ? "justify-between gap-2 px-3" : "justify-center",
        )}
        style={{ height: 56 }}
      >
        <Link
          href="/"
          aria-label={DOMAIN.appName}
          className={cn(
            "flex items-center gap-2 rounded-[6px] outline-none",
            "focus-visible:ring-2 focus-visible:ring-[#0071e3]/40",
          )}
        >
          <BrandMark />
          {expanded ? (
            <span
              className="truncate text-[13px] font-semibold"
              style={{ color: "#1d1d1f", letterSpacing: -0.1 }}
            >
              {DOMAIN.appName}
            </span>
          ) : null}
        </Link>
        {expanded && showToggle ? (
          <CollapseToggle expanded={expanded} onToggle={toggle} />
        ) : null}
      </div>

      {!expanded && showToggle ? (
        <div className="flex shrink-0 items-center justify-center pb-1">
          <CollapseToggle expanded={expanded} onToggle={toggle} />
        </div>
      ) : null}

      <nav
        aria-label="Primary"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pt-1.5",
          expanded ? "items-stretch px-3" : "items-center",
        )}
      >
        {topEntries.map((entry) => {
          if (entry.kind === "leaf") return renderLeaf(entry.item);
          const GroupIcon = ICON_MAP[entry.item.icon] ?? List;
          const open = Boolean(openGroups[entry.item.label]);
          const childActive = entry.children.some((child) =>
            child.href ? isActive(pathname, child.href) : false,
          );
          return (
            <div
              key={`group:${entry.item.label}`}
              className={cn("flex flex-col", expanded ? "gap-1" : "gap-1.5")}
            >
              <SidebarGroupHeader
                label={entry.item.label}
                icon={GroupIcon}
                expanded={expanded}
                open={open}
                childActive={childActive}
                onToggle={() => toggleGroup(entry.item.label)}
              />
              {open
                ? entry.children.map((child) =>
                    renderLeaf(child, { nested: true }),
                  )
                : null}
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-1.5 pb-3 pt-2",
          expanded ? "items-stretch px-3" : "items-center",
        )}
      >
        {bottomEntries.map((entry) =>
          entry.kind === "leaf" ? renderLeaf(entry.item) : null,
        )}
        {user ? (
          <div
            className={cn(
              "mt-1 flex select-none items-center",
              expanded ? "gap-2.5 px-1.5" : "justify-center",
            )}
            data-sidebar-tip={expanded ? undefined : ""}
            title={
              expanded
                ? undefined
                : `${user.full_name}${roleConfig ? ` · ${roleConfig.label}` : ""}`
            }
            aria-label={user.full_name}
          >
            <div
              className="flex shrink-0 items-center justify-center rounded-full text-white"
              style={{
                width: 28,
                height: 28,
                background: "#0071e3",
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}
              aria-hidden
            >
              {getInitials(user.full_name)}
            </div>
            {expanded ? (
              <div className="flex min-w-0 flex-col leading-tight">
                <span
                  className="truncate text-[12.5px] font-medium"
                  style={{ color: "#1d1d1f" }}
                >
                  {user.full_name}
                </span>
                {roleConfig ? (
                  <span
                    className="truncate text-[11px]"
                    style={{ color: "#86868b" }}
                  >
                    {roleConfig.label}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { expanded: userExpanded, toggle } = useSidebar();
  const [hovered, setHovered] = useState(false);
  /**
   * The user's persisted toggle wins: once they've locked the sidebar open,
   * hovering off the rail never auto-collapses it. The hover state only
   * matters when the user has the sidebar in its closed state — in that
   * case we transiently expand on enter and collapse on leave.
   */
  const effectiveExpanded = userExpanded || hovered;
  const width = effectiveExpanded
    ? SIDEBAR_EXPANDED_WIDTH
    : SIDEBAR_COLLAPSED_WIDTH;
  return (
    <aside
      className="fixed left-0 top-0 z-30 hidden h-full transition-[width] duration-200 ease-out lg:block"
      style={{ width }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <SidebarRail expanded={effectiveExpanded} onToggle={toggle} />
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
      <SheetContent
        side="left"
        className="p-0"
        style={{ width: SIDEBAR_EXPANDED_WIDTH }}
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarRail expanded showToggle={false} />
      </SheetContent>
    </Sheet>
  );
}
