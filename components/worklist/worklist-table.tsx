"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";

import type { Request, User } from "@/lib/types";
import { DOMAIN } from "@/lib/domain.config";
import { listUsers } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/domain/status-badge";
import { PriorityBadge } from "@/components/domain/priority-badge";

function daysOpen(createdAt: string): number {
  return Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function buildColumns(usersMap: Map<string, User>): ColumnDef<Request>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      size: 40,
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <Link
          href={`/${DOMAIN.entitySlug}/${row.original.id}`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.getValue("title")}
        </Link>
      ),
      enableSorting: true,
    },
    {
      accessorKey: "category",
      header: "Category",
      enableSorting: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      enableSorting: true,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      enableSorting: true,
    },
    {
      id: "assigned_to",
      header: "Assigned To",
      accessorFn: (row) =>
        usersMap.get(row.assigned_to ?? "")?.full_name ?? "Unassigned",
      cell: ({ getValue }) => (
        <span className="text-sm">{getValue() as string}</span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "estimated_value",
      header: "Est. Value",
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">
          {formatCurrency(row.original.estimated_value)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: "days_open",
      header: "Age",
      accessorFn: (row) => daysOpen(row.created_at),
      cell: ({ row }) => {
        const created = row.original.created_at;
        return (
          <span className="text-muted-foreground tabular-nums">
            {formatDistanceToNowStrict(new Date(created), { addSuffix: false })}
          </span>
        );
      },
      enableSorting: true,
    },
  ];
}

function SortIcon({ isSorted }: { isSorted: false | "asc" | "desc" }) {
  if (isSorted === "asc") return <ChevronUp className="size-3.5" />;
  if (isSorted === "desc") return <ChevronDown className="size-3.5" />;
  return <ArrowUpDown className="size-3.5 opacity-40" />;
}

export function WorklistTable({ items }: { items: Request[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());

  useEffect(() => {
    listUsers().then((users) => {
      setUsersMap(new Map(users.map((u) => [u.id, u])));
    });
  }, []);

  const columns = useMemo(() => buildColumns(usersMap), [usersMap]);

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.id,
    initialState: { pagination: { pageSize: 10 } },
  });

  const router = useRouter();
  const selectedCount = Object.keys(rowSelection).length;

  const paginationRange = useMemo(() => {
    const { pageIndex, pageSize } = table.getState().pagination;
    const total = table.getFilteredRowModel().rows.length;
    const start = pageIndex * pageSize + 1;
    const end = Math.min((pageIndex + 1) * pageSize, total);
    return { start, end, total };
  }, [table.getState().pagination, table.getFilteredRowModel().rows.length]);

  const entityLabel = DOMAIN.entity.plural.toLowerCase();

  return (
    <div className="space-y-2">
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-accent/50 px-4 py-2">
          <span className="text-sm font-medium">
            {selectedCount} {selectedCount !== 1 ? entityLabel : DOMAIN.entity.singular.toLowerCase()} selected
          </span>
        </div>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 py-0.5 rounded"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        <SortIcon
                          isSorted={header.column.getIsSorted()}
                        />
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="cursor-pointer"
                  onClick={() => router.push(`/${DOMAIN.entitySlug}/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No {entityLabel} match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          {paginationRange.start}–{paginationRange.end} of{" "}
          {paginationRange.total} {entityLabel}
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(v) => table.setPageSize(Number(v))}
            >
              <SelectTrigger size="sm" className="w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
