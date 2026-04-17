/** Default page-size options for data table pagination. */
export const DATA_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export type DataTablePageSize =
  (typeof DATA_TABLE_PAGE_SIZE_OPTIONS)[number];
