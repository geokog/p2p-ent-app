"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DataTableEmptyProps = {
  children: ReactNode;
  className?: string;
};

/** Centered muted message when a table has no rows. */
export function DataTableEmpty({ children, className }: DataTableEmptyProps) {
  return (
    <p
      className={cn(
        "py-8 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
