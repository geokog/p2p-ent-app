"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DataTableToolbarProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Top row for tabs, selects, and filter popovers.
 */
export function DataTableToolbar({ children, className }: DataTableToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}
