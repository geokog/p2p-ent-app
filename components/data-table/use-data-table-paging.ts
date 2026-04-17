"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DATA_TABLE_PAGE_SIZE_OPTIONS,
  type DataTablePageSize,
} from "./constants";

export type UseDataTablePagingOptions = {
  /** Defaults to {@link DATA_TABLE_PAGE_SIZE_OPTIONS}. */
  pageSizeOptions?: readonly number[];
  initialPage?: number;
  initialRowsPerPage?: DataTablePageSize;
};

/**
 * Client-side paging for filtered row arrays (page index, rows per page, slice,
 * clamp when data shrinks).
 */
export function useDataTablePaging<T>(
  items: T[],
  options?: UseDataTablePagingOptions,
) {
  const pageSizeOptions =
    options?.pageSizeOptions ?? DATA_TABLE_PAGE_SIZE_OPTIONS;
  const initialRpp =
    options?.initialRowsPerPage ??
    (pageSizeOptions[0] as DataTablePageSize) ??
    10;

  const [page, setPage] = useState(options?.initialPage ?? 0);
  const [rowsPerPage, setRowsPerPage] =
    useState<number>(initialRpp);

  const totalCount = items.length;
  const lastPage = Math.max(
    0,
    Math.ceil(totalCount / rowsPerPage) - 1,
  );

  const pagedItems = useMemo(() => {
    const start = page * rowsPerPage;
    return items.slice(start, start + rowsPerPage);
  }, [items, page, rowsPerPage]);

  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  useEffect(() => {
    setPage(0);
  }, [rowsPerPage]);

  return {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    pageSizeOptions,
    lastPage,
    pagedItems,
    totalCount,
    resetPage: () => setPage(0),
  };
}
