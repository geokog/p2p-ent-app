"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";

import type { Request } from "@/lib/types";
import { DOMAIN } from "@/lib/domain.config";
import { listRequests } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { canPerformAction } from "@/lib/role-permissions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WorklistFiltersBar,
  type WorklistFilters,
} from "@/components/worklist/worklist-filters";
import { WorklistTable } from "@/components/worklist/worklist-table";

const defaultFilters: WorklistFilters = {
  search: "",
  statuses: [],
  priority: null,
};

/* CUSTOMIZE: Adjust filter logic to match your entity fields. */
function applyFilters(items: Request[], filters: WorklistFilters): Request[] {
  let result = items;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter((r) => {
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchCategory = r.category.toLowerCase().includes(q);
      const matchId = r.id.toLowerCase().includes(q);
      return matchTitle || matchCategory || matchId;
    });
  }

  if (filters.statuses.length > 0) {
    result = result.filter((r) => filters.statuses.includes(r.status));
  }

  if (filters.priority) {
    result = result.filter((r) => r.priority === filters.priority);
  }

  return result;
}

/* CUSTOMIZE: Adjust CSV columns to match your entity fields. */
function exportToCSV(items: Request[]) {
  const headers = [
    "ID",
    "Title",
    "Category",
    "Status",
    "Priority",
    "Estimated Value",
    "Created",
    "Submitted",
    "Decided",
  ];
  const rows = items.map((r) => [
    r.id,
    r.title,
    r.category,
    r.status,
    r.priority,
    r.estimated_value,
    r.created_at,
    r.submitted_at ?? "",
    r.decided_at ?? "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${v}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${DOMAIN.entitySlug}-worklist.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function WorklistPage() {
  const { user } = useAuth();
  const userRole = user?.role ?? "requester";
  const showCreate = canPerformAction(userRole, "create");

  const [allItems, setAllItems] = useState<Request[]>([]);
  const [filters, setFilters] = useState<WorklistFilters>(defaultFilters);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newPriority, setNewPriority] = useState<string>("standard");

  useEffect(() => {
    listRequests().then(setAllItems);
  }, []);

  useEffect(() => {
    const handler = () => listRequests().then(setAllItems);
    window.addEventListener("chat-data-changed", handler);
    return () => window.removeEventListener("chat-data-changed", handler);
  }, []);

  const filteredItems = useMemo(
    () => applyFilters(allItems, filters),
    [allItems, filters],
  );

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {DOMAIN.entity.plural} Worklist
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {filteredItems.length}{" "}
              {filteredItems.length !== 1
                ? DOMAIN.entity.plural.toLowerCase()
                : DOMAIN.entity.singular.toLowerCase()}
              {filters.search || filters.statuses.length > 0 || filters.priority
                ? " matching filters"
                : " total"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => exportToCSV(filteredItems)}
            >
              <Download className="size-4" />
              Download CSV
            </Button>
            {showCreate && (
              <Button
                className="gap-1.5"
                onClick={() => setShowNewDialog(true)}
              >
                <Plus className="size-4" />
                New {DOMAIN.entity.singular}
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <WorklistFiltersBar filters={filters} onFiltersChange={setFilters} />

        {/* Table */}
        <WorklistTable items={filteredItems} />
      </div>

      {/* CUSTOMIZE: New request dialog — adjust fields for your entity. */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New {DOMAIN.entity.singular}</DialogTitle>
            <DialogDescription>
              Create a new {DOMAIN.entity.singular.toLowerCase()}. Fill in the
              details below.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const title = (formData.get("title") as string) || "";
              const description =
                (formData.get("description") as string) || "";
              const category = (formData.get("category") as string) || "";
              const estimatedValue =
                Number(formData.get("estimatedValue")) || 0;

              const now = new Date().toISOString();
              const newItem: Request = {
                id: `req-new-${Date.now()}`,
                org_id: user?.org_id ?? "org_001",
                title,
                description,
                requester_id: user?.id ?? "",
                assigned_to: null,
                status: "draft",
                priority: newPriority as Request["priority"],
                category,
                estimated_value: estimatedValue,
                submitted_at: null,
                decided_at: null,
                closed_at: null,
                created_at: now,
                updated_at: now,
                kognitos_run_id: "",
                episode_id: null,
              };

              setAllItems((prev) => [newItem, ...prev]);
              setShowNewDialog(false);
              setNewPriority("standard");
              form.reset();
              alert(`${DOMAIN.entity.singular} created successfully`);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" type="text" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" type="text" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                name="category"
                type="text"
                placeholder="e.g. equipment, software"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={newPriority} onValueChange={setNewPriority}>
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {DOMAIN.priorities.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimatedValue">Estimated Value</Label>
              <Input
                id="estimatedValue"
                name="estimatedValue"
                type="number"
                min={0}
                step={0.01}
                placeholder="0"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowNewDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create {DOMAIN.entity.singular}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
