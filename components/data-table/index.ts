/**
 * Reusable building blocks for filterable, paginated shadcn tables (toolbar layout, bordered shell,
 * pagination footer, optional sticky Actions column).
 *
 * @example
 * ```tsx
 * const filtered = useMemo(() => rows.filter(...), [rows, filter]);
 * const paging = useDataTablePaging(filtered);
 * const sticky = useStickyActionsColumn();
 *
 * return (
 *   <DataTableCard title="Items" description="…">
 *     <div className="space-y-4">
 *       <DataTableToolbar>…filters…</DataTableToolbar>
 *       <div className="max-w-full">
 *         <Table
 *           ref={sticky.setTableScrollContainer}
 *           className={dataTableShellClassName}
 *         >
 *           …
 *           <TableHead className={dataTableStickyActionsHeadClassName(sticky.actionsColumnStacked)}>
 *             Actions
 *           </TableHead>
 *         </Table>
 *       </div>
 *       <DataTablePagination
 *         page={paging.page}
 *         lastPage={paging.lastPage}
 *         onPageChange={paging.setPage}
 *         rowsPerPage={paging.rowsPerPage}
 *         onRowsPerPageChange={paging.setRowsPerPage}
 *         totalCount={paging.totalCount}
 *       />
 *     </div>
 *   </DataTableCard>
 * );
 * ```
 */

export {
  DATA_TABLE_PAGE_SIZE_OPTIONS,
  type DataTablePageSize,
} from "./constants";
export { DataTableCard, type DataTableCardProps } from "./data-table-card";
export { DataTableEmpty, type DataTableEmptyProps } from "./data-table-empty";
export {
  DataTablePagination,
  type DataTablePaginationProps,
} from "./data-table-pagination";
export {
  DataTableToolbar,
  type DataTableToolbarProps,
} from "./data-table-toolbar";
export {
  dataTableActionIconButtonClassName,
  dataTableEmeraldPrimaryButtonClassName,
  dataTableShellClassName,
  dataTableStickyActionsCellClassName,
  dataTableStickyActionsEdgeClassName,
  dataTableStickyActionsHeadClassName,
} from "./styles";
export { useDataTablePaging, type UseDataTablePagingOptions } from "./use-data-table-paging";
export { useStickyActionsColumn } from "./use-sticky-actions-column";
