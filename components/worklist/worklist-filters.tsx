"use client";

import { useCallback } from "react";
import { DOMAIN } from "@/lib/domain.config";
import { getStatusLabel } from "@/components/domain/status-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Search, SlidersHorizontal, X } from "lucide-react";

export interface WorklistFilters {
  search: string;
  statuses: string[];
  priority: string | null;
}

interface WorklistFiltersProps {
  filters: WorklistFilters;
  onFiltersChange: (f: WorklistFilters) => void;
}

export function WorklistFiltersBar({
  filters,
  onFiltersChange,
}: WorklistFiltersProps) {
  const updateFilter = useCallback(
    <K extends keyof WorklistFilters>(key: K, value: WorklistFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const toggleStatus = useCallback(
    (status: string) => {
      const next = filters.statuses.includes(status)
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status];
      updateFilter("statuses", next);
    },
    [filters.statuses, updateFilter]
  );

  const clearAll = useCallback(() => {
    onFiltersChange({
      search: "",
      statuses: [],
      priority: null,
    });
  }, [onFiltersChange]);

  const hasActiveFilters =
    filters.search !== "" ||
    filters.statuses.length > 0 ||
    filters.priority !== null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${DOMAIN.entity.plural.toLowerCase()}...`}
          value={filters.search}
          onChange={(e) => updateFilter("search", e.target.value)}
          className="pl-9"
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <SlidersHorizontal className="size-4" />
            Status
            {filters.statuses.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {filters.statuses.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {DOMAIN.statuses.map((s) => (
              <label
                key={s.value}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={filters.statuses.includes(s.value)}
                  onCheckedChange={() => toggleStatus(s.value)}
                />
                {getStatusLabel(s.value)}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center rounded-md border bg-background">
        {[{ value: "all", label: "All" }, ...DOMAIN.priorities].map((p) => {
          const isActive =
            (p.value === "all" && filters.priority === null) ||
            p.value === filters.priority;
          return (
            <button
              key={p.value}
              onClick={() =>
                updateFilter("priority", p.value === "all" ? null : p.value)
              }
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors first:rounded-l-md last:rounded-r-md ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1 text-muted-foreground">
          <X className="size-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
