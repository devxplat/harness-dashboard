"use client";

import { EmptyBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

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
  /** Controls rendered in the top toolbar (right-aligned, before the Columns menu). */
  actions?: ReactNode;
  pageSize?: number;
  /** Choices offered in the rows-per-page selector. */
  pageSizeOptions?: number[];
  emptyMessage?: string;
  /** Rendered below the table, receives the filtered rows (e.g. for a totals line). */
  footer?: (rows: TData[]) => ReactNode;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  search,
  actions,
  pageSize = 20,
  pageSizeOptions = [10, 25, 50, 100],
  emptyMessage = "No results.",
  footer,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rawFilter, setRawFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const listId = useId();

  // Debounce so large datasets don't re-filter on every keystroke; the input stays
  // responsive (rawFilter) while the table filters on the settled value.
  useEffect(() => {
    const id = setTimeout(() => setGlobalFilter(rawFilter), 200);
    return () => clearTimeout(id);
  }, [rawFilter]);

  // Autocomplete: distinct values of the searchable fields (capped, short ones only).
  const suggestions = useMemo(() => {
    if (!search) return [];
    const seen = new Set<string>();
    for (const row of data) {
      for (const f of search.fields) {
        const v = row[f];
        if (typeof v === "string" && v.length > 0 && v.length <= 80) seen.add(v);
      }
      if (seen.size >= 50) break;
    }
    return [...seen].sort();
  }, [data, search]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
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
      <div className="flex items-center gap-2">
        {search ? (
          <>
            <Input
              list={listId}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel}
              value={rawFilter}
              onChange={(e) => setRawFilter(e.target.value)}
              className="max-w-sm"
            />
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(!!v)}
                  >
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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

      {rows.length > 0 ? (
        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(v) => table.setPageSize(Number(v))}
            >
              <SelectTrigger size="sm" className="w-[4.5rem]" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <span>
              Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())} ·{" "}
              {filtered.length} rows
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
        </div>
      ) : null}
    </div>
  );
}
