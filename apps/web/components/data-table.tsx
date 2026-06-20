"use client";

import { EmptyBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ColumnDef,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";

// Per-column right-alignment for numeric columns.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "right";
  }
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Adds a search box that matches the listed row fields (case-insensitive substring). */
  search?: { fields: (keyof TData)[]; placeholder: string; ariaLabel: string };
  pageSize?: number;
  emptyMessage?: string;
  /** Rendered below the table, receives the filtered rows (e.g. for a totals line). */
  footer?: (rows: TData[]) => ReactNode;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  search,
  pageSize = 20,
  emptyMessage = "No results.",
  footer,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, value) => {
      if (!search) return true;
      const needle = String(value).toLowerCase();
      return search.fields.some((f) =>
        String(row.original[f] ?? "").toLowerCase().includes(needle),
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const filtered = table.getFilteredRowModel().rows;

  return (
    <div className="space-y-3">
      {search ? (
        <Input
          placeholder={search.placeholder}
          aria-label={search.ariaLabel}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyBlock message={emptyMessage} />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => {
                    const align = header.column.columnDef.meta?.align;
                    const sorted = header.column.getIsSorted();
                    const label = header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext());
                    return (
                      <TableHead key={header.id} className={align === "right" ? "text-right" : undefined}>
                        {!header.isPlaceholder && header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={`inline-flex items-center gap-1 hover:text-foreground ${
                              align === "right" ? "flex-row-reverse" : ""
                            }`}
                          >
                            {label}
                            {sorted === "asc" ? (
                              <ArrowUp className="size-3.5" aria-label="sorted ascending" />
                            ) : sorted === "desc" ? (
                              <ArrowDown className="size-3.5" aria-label="sorted descending" />
                            ) : (
                              <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
                            )}
                          </button>
                        ) : (
                          label
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const align = cell.column.columnDef.meta?.align;
                    return (
                      <TableCell
                        key={cell.id}
                        className={align === "right" ? "text-right tabular-nums" : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {footer && rows.length > 0 ? footer(filtered.map((r) => r.original)) : null}

      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} · {filtered.length}{" "}
            rows
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
