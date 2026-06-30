"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  description?: string;
};

const DEFAULT_RESULT_LIMIT = 80;

export function useDebouncedValue<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

export function SearchableSelect({
  label,
  value,
  options,
  onValueChange,
  placeholder = "Select",
  emptyMessage = "No matches found.",
  className,
  leadingIcon,
  resultLimit = DEFAULT_RESULT_LIMIT,
}: {
  label: string;
  value: string;
  options: SearchableOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  leadingIcon?: ReactNode;
  resultLimit?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 140);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const rows = q
      ? options.filter((option) =>
          [option.label, option.value, option.description ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : options;
    return rows.slice(0, resultLimit);
  }, [debouncedQuery, options, resultLimit]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          className={cn("justify-between gap-2", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {leadingIcon}
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[360px] min-w-60 overflow-hidden p-2"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Input
          aria-label={`Search ${label}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className="h-9"
        />
        <div
          role="listbox"
          aria-label={`${label} options`}
          className="mt-2 max-h-64 overflow-y-auto"
        >
          {filtered.length ? (
            filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  option.value === value && "bg-muted",
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    option.value === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.description ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          )}
        </div>
        {options.length > resultLimit ? (
          <p className="mt-2 px-2 text-xs text-muted-foreground">
            Showing first {resultLimit} matches. Type to narrow the list.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
