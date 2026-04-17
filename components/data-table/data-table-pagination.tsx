"use client";

import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { DATA_TABLE_PAGE_SIZE_OPTIONS } from "./constants";

export type DataTablePaginationProps = {
  page: number;
  lastPage: number;
  onPageChange: (page: number) => void;
  rowsPerPage: number;
  onRowsPerPageChange: (n: number) => void;
  totalCount: number;
  /** Options for the rows-per-page select; defaults to {@link DATA_TABLE_PAGE_SIZE_OPTIONS}. */
  pageSizeOptions?: readonly number[];
  /** Label next to the page-size select (default `"Rows"`). */
  rowsLabel?: string;
  className?: string;
};

/**
 * Footer: “Showing X – Y of Z”, rows-per-page select, first/prev/next/last controls
 * (standard “showing range”, rows-per-page, and page navigation controls).
 */
export function DataTablePagination({
  page,
  lastPage,
  onPageChange,
  rowsPerPage,
  onRowsPerPageChange,
  totalCount,
  pageSizeOptions = DATA_TABLE_PAGE_SIZE_OPTIONS,
  rowsLabel = "Rows",
  className,
}: DataTablePaginationProps) {
  const showingFrom =
    totalCount === 0 ? 0 : page * rowsPerPage + 1;
  const showingTo = Math.min(
    (page + 1) * rowsPerPage,
    totalCount,
  );

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center justify-between gap-3 border-t pt-4"
      }
    >
      <p className="text-sm text-muted-foreground">
        Showing {showingFrom}–{showingTo} of {totalCount}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{rowsLabel}</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(v) => onRowsPerPageChange(Number(v))}
          >
            <SelectTrigger size="sm" className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="First page"
            disabled={page <= 0}
            onClick={() => onPageChange(0)}
          >
            <ChevronFirst className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Previous page"
            disabled={page <= 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Next page"
            disabled={page >= lastPage}
            onClick={() => onPageChange(Math.min(lastPage, page + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Last page"
            disabled={page >= lastPage}
            onClick={() => onPageChange(lastPage)}
          >
            <ChevronLast className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
