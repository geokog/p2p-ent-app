"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  ExceptionDetailBundleDto,
  ExceptionEventDto,
  ExceptionStateUi,
  ExceptionSummaryDto,
} from "@/lib/kognitos/exception-view-model";

type MappingCategory =
  | "RAW_KOGNITOS"
  | "RENAMED"
  | "FORMATTED"
  | "DERIVED"
  | "APP_CREATED"
  | "UNKNOWN";

type InspectorPayload = ExceptionDetailBundleDto & {
  rawKognitosDebug?: {
    note: string;
    exceptionRaw: Record<string, unknown>;
    eventsRaw: Record<string, unknown>;
  };
};

type FieldRow = {
  section: string;
  field: string;
  value: unknown;
  category: MappingCategory;
  categoryDetails: CategoryDetails;
  placement: string;
  notes: string;
};

type MappingSpec = {
  field: string;
  rawSource: string;
  rawPaths: string[];
  transformation: string;
  category: MappingCategory;
  notes: string;
};

type MappingRow = {
  field: string;
  browserValue: unknown;
  rawSource: string;
  rawValue: unknown;
  transformation: string;
  category: MappingCategory;
  categoryDetails: CategoryDetails;
  notes: string;
};

type SourceField = {
  fieldName: string;
  value: unknown;
};

type CategoryDetails = {
  category: MappingCategory;
  displayFieldName: string;
  displayValue: unknown;
  originalFieldName?: string;
  originalValue?: unknown;
  sourceFields: SourceField[];
  explanation: string;
};

type ListStateFilter = "pending" | "non_resolved" | "resolved" | "archived";

const LIST_PAGE_SIZE = 25;
const LIST_FETCH_PAGE_SIZE = 100;
const STATE_FILTERS: { value: ListStateFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "non_resolved", label: "All non-resolved" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
];

const CATEGORY_KEY: { category: MappingCategory; description: string }[] = [
  {
    category: "RAW_KOGNITOS",
    description: "exact field name and exact value exist in the raw Kognitos payload",
  },
  {
    category: "RENAMED",
    description: "value came from Kognitos, but the app changed the field name",
  },
  {
    category: "FORMATTED",
    description: "value came from Kognitos, but the app changed how it is displayed",
  },
  {
    category: "DERIVED",
    description:
      "value was extracted, shortened, calculated, or composed from one or more Kognitos fields",
  },
  {
    category: "APP_CREATED",
    description:
      "value was created by the web app and does not exist in the raw Kognitos payload",
  },
  {
    category: "UNKNOWN",
    description: "raw source cannot be confirmed",
  },
];

const FIELD_META: Record<string, { placement: string; notes: string }> = {
  "exception.exceptionId": {
    placement: "Header, Technical details",
    notes: "Primary identifier displayed to operators and useful for support/debugging.",
  },
  "exception.state": {
    placement: "Status badge",
    notes: "Use as the main exception status indicator.",
  },
  "exception.groupLabel": {
    placement: "Category badge",
    notes: "Use as a lightweight category or grouping label.",
  },
  "exception.title": {
    placement: "Header",
    notes: "Human-readable summary for list cards and detail headers.",
  },
  "exception.descriptionFull": {
    placement: "Description, Resolution panel",
    notes: "Show before submitting suggested guidance so the user knows what will be sent.",
  },
  "exception.messageFull": {
    placement: "Technical details",
    notes: "Useful for troubleshooting; can be long and should be collapsible.",
  },
  "exception.runId": {
    placement: "Header, Run context",
    notes: "Use for run links, support lookup, and Network/API debugging.",
  },
  "exception.automationId": {
    placement: "Header, Technical details",
    notes: "Use for Kognitos run links and adapter debugging.",
  },
  "exception.automationDisplayName": {
    placement: "Header, List card",
    notes: "Friendly app label when local automation metadata exists.",
  },
  "exception.createTime": {
    placement: "Header, Technical details",
    notes: "Use for recency and timeline context.",
  },
  "exception.assigneeShort": {
    placement: "Technical details",
    notes: "Useful for diagnosing which resolver/agent owns the exception.",
  },
  "exception.executionId": {
    placement: "Technical details",
    notes: "Useful for Kognitos support/debugging.",
  },
  "exception.locationDisplay": {
    placement: "Technical details",
    notes: "Use when showing where in the automation the exception occurred.",
  },
  "exception.extra": {
    placement: "Debug drawer",
    notes: "Extra string metadata; inspect before promoting into user-facing UI.",
  },
  "exception.automationResource": {
    placement: "Debug drawer",
    notes: "Full Kognitos resource path; usually hidden from end users.",
  },
  "exception.runResource": {
    placement: "Debug drawer",
    notes: "Full Kognitos resource path; usually hidden from end users.",
  },
  "exception.exceptionResourceName": {
    placement: "Debug drawer",
    notes: "Full Kognitos exception resource; usually hidden from end users.",
  },
  "runContext.runId": {
    placement: "Run context",
    notes: "App run context identifier.",
  },
  "runContext.foundInDb": {
    placement: "Run context",
    notes: "App-only signal showing whether local run context was found.",
  },
  "runContext.keyValues": {
    placement: "Run context",
    notes: "Curated app context values.",
  },
  "runContext.inputFiles": {
    placement: "Run context",
    notes: "Curated app input file values.",
  },
  eventsAgentIdUsed: {
    placement: "Debug drawer",
    notes: "Agent id selected by the server adapter for ListEvents.",
  },
  kognitosRunUrl: {
    placement: "Header action",
    notes: "Convenience link built by the app.",
  },
  rawKognitosDebug: {
    placement: "Raw JSON",
    notes: "Only present when safe debug mode includes raw Kognitos payloads.",
  },
};

const MAPPING_SPECS: MappingSpec[] = [
  {
    field: "exception.exceptionId",
    rawSource: "exceptionRaw.name",
    rawPaths: ["name", "exception_id", "exceptionId"],
    transformation: "Extract short id from full Kognitos exception resource name.",
    category: "DERIVED",
    notes: "Mapped id may be shortened from a full resource path.",
  },
  {
    field: "exception.state",
    rawSource: "exceptionRaw.state",
    rawPaths: ["state"],
    transformation: "Normalize Kognitos state into the browser response enum.",
    category: "FORMATTED",
    notes: "Raw value may include a longer enum-style prefix.",
  },
  {
    field: "exception.groupLabel",
    rawSource: "exceptionRaw.group",
    rawPaths: ["group"],
    transformation: "Extract a compact label from the group resource/string.",
    category: "DERIVED",
    notes: "Label is intended for UI grouping.",
  },
  {
    field: "exception.title",
    rawSource: "exceptionRaw.description or exceptionRaw.message",
    rawPaths: ["description", "message"],
    transformation: "Derive a short human-readable title from longer Kognitos text.",
    category: "DERIVED",
    notes: "Not a direct raw Kognitos field.",
  },
  {
    field: "exception.automationId",
    rawSource: "exceptionRaw.automation",
    rawPaths: ["automation"],
    transformation: "Extract short automation id from the Kognitos resource path.",
    category: "DERIVED",
    notes: "Used by app routes and Kognitos links.",
  },
  {
    field: "exception.automationDisplayName",
    rawSource: "local kognitos_automations.display_name",
    rawPaths: [],
    transformation: "Look up friendly display name in the app database.",
    category: "APP_CREATED",
    notes: "Created by the web app, not expected in the raw Kognitos exception payload.",
  },
  {
    field: "exception.runId",
    rawSource: "exceptionRaw.run or exceptionRaw.run_name",
    rawPaths: ["run", "run_name"],
    transformation: "Extract short run id from the Kognitos resource path.",
    category: "DERIVED",
    notes: "Used to load run context and build run links.",
  },
  {
    field: "exception.createTime",
    rawSource: "exceptionRaw.create_time or exceptionRaw.createTime",
    rawPaths: ["create_time", "createTime"],
    transformation: "Expose timestamp with browser response field casing.",
    category: "RENAMED",
    notes: "Value is expected to come from Kognitos if raw payload confirms it.",
  },
  {
    field: "exception.assigneeShort",
    rawSource: "exceptionRaw.assignee",
    rawPaths: ["assignee"],
    transformation: "Extract short assignee segment from the raw resource/string.",
    category: "DERIVED",
    notes: "Helpful for understanding resolver ownership.",
  },
  {
    field: "exception.executionId",
    rawSource: "exceptionRaw.execution_id or exceptionRaw.executionId",
    rawPaths: ["execution_id", "executionId"],
    transformation: "Expose execution id with browser response field casing.",
    category: "RENAMED",
    notes: "Value is expected to come from Kognitos if raw payload confirms it.",
  },
  {
    field: "exception.messageFull",
    rawSource: "exceptionRaw.message",
    rawPaths: ["message"],
    transformation: "Rename raw message into the browser response field.",
    category: "RENAMED",
    notes: "Usually a long technical/interpreter message.",
  },
  {
    field: "exception.descriptionFull",
    rawSource: "exceptionRaw.description",
    rawPaths: ["description"],
    transformation: "Rename raw description into the browser response field.",
    category: "RENAMED",
    notes: "Often the content used by suggested guidance.",
  },
  {
    field: "exception.locationDisplay",
    rawSource: "exceptionRaw.location",
    rawPaths: ["location"],
    transformation: "Format the raw location value into a display string.",
    category: "FORMATTED",
    notes: "Raw location can be object-like or byte-oriented.",
  },
  {
    field: "exception.extra",
    rawSource: "exceptionRaw.extra",
    rawPaths: ["extra"],
    transformation: "Filter/normalize extra metadata for browser use.",
    category: "FORMATTED",
    notes: "Mapped value may omit non-string nested raw values.",
  },
  {
    field: "exception.automationResource",
    rawSource: "exceptionRaw.automation",
    rawPaths: ["automation"],
    transformation: "Preserve the full Kognitos automation resource path.",
    category: "RENAMED",
    notes: "Value is preserved from Kognitos, but the browser response field name changes.",
  },
  {
    field: "exception.runResource",
    rawSource: "exceptionRaw.run or exceptionRaw.run_name",
    rawPaths: ["run", "run_name"],
    transformation: "Preserve the full Kognitos run resource path.",
    category: "RENAMED",
    notes: "Value is preserved from Kognitos, but the browser response field name changes.",
  },
  {
    field: "exception.exceptionResourceName",
    rawSource: "exceptionRaw.name",
    rawPaths: ["name"],
    transformation: "Preserve the full Kognitos exception resource path.",
    category: "RENAMED",
    notes: "Value is preserved from Kognitos, but the browser response field name changes.",
  },
  {
    field: "events",
    rawSource: "eventsRaw.events",
    rawPaths: ["events"],
    transformation: "Map raw event variants into createTime, kind, summary, and detail.",
    category: "FORMATTED",
    notes: "All mapped event kinds are visible in this debug view.",
  },
  {
    field: "runContext",
    rawSource: "local run payload/database",
    rawPaths: [],
    transformation: "Build app run context from local run data.",
    category: "APP_CREATED",
    notes: "Not from the raw Kognitos exception response.",
  },
  {
    field: "eventsAgentIdUsed",
    rawSource: "adapter resolution/configuration",
    rawPaths: [],
    transformation: "Report which agent id the server used to call ListEvents.",
    category: "APP_CREATED",
    notes: "Created by the web app adapter for debugging.",
  },
  {
    field: "kognitosRunUrl",
    rawSource: "automationId + runId + app URL helper",
    rawPaths: [],
    transformation: "Build an app-side link to the Kognitos run results page.",
    category: "APP_CREATED",
    notes: "Convenience URL, not returned by the Kognitos exception payload.",
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getByPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!isPlainObject(acc)) return undefined;
    return acc[key];
  }, root);
}

function firstAvailable(root: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = getByPath(root, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

function sourceFieldsForSpec(
  root: unknown,
  paths: string[],
  sourcePrefix: string,
): SourceField[] {
  return paths
    .map((path) => ({
      fieldName: `${sourcePrefix}.${path}`,
      value: getByPath(root, path),
    }))
    .filter((field) => field.value !== undefined);
}

function mappingSpecForField(fieldName: string): MappingSpec | null {
  return MAPPING_SPECS.find((spec) => spec.field === fieldName) ?? null;
}

function explanationForCategory(category: MappingCategory): string {
  return (
    CATEGORY_KEY.find((item) => item.category === category)?.description ??
    "raw source cannot be confirmed"
  );
}

function buildCategoryDetails(input: {
  category: MappingCategory;
  displayFieldName: string;
  displayValue: unknown;
  originalFieldName?: string;
  originalValue?: unknown;
  sourceFields?: SourceField[];
  explanation?: string;
}): CategoryDetails {
  return {
    category: input.category,
    displayFieldName: input.displayFieldName,
    displayValue: input.displayValue,
    originalFieldName: input.originalFieldName,
    originalValue: input.originalValue,
    sourceFields: input.sourceFields ?? [],
    explanation: input.explanation ?? explanationForCategory(input.category),
  };
}

function categoryDetailsFromSpec(
  displayFieldName: string,
  displayValue: unknown,
  payload: InspectorPayload,
  category: MappingCategory,
): CategoryDetails {
  const spec = mappingSpecForField(displayFieldName);
  if (!spec || !payload.rawKognitosDebug || spec.rawPaths.length === 0) {
    return buildCategoryDetails({
      category,
      displayFieldName,
      displayValue,
      originalFieldName: spec?.rawSource,
    });
  }
  const rawRoot =
    spec.field === "events"
      ? payload.rawKognitosDebug.eventsRaw
      : payload.rawKognitosDebug.exceptionRaw;
  const sourcePrefix = spec.field === "events" ? "eventsRaw" : "exceptionRaw";
  const sourceFields = sourceFieldsForSpec(rawRoot, spec.rawPaths, sourcePrefix);
  return buildCategoryDetails({
    category,
    displayFieldName,
    displayValue,
    originalFieldName: sourceFields[0]?.fieldName ?? spec.rawSource,
    originalValue: sourceFields[0]?.value,
    sourceFields,
  });
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function maybePrettyJson(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.stringify(JSON.parse(trimmed) as unknown, null, 2);
  } catch {
    return value;
  }
}

function fieldMeta(section: string, field: string) {
  return (
    FIELD_META[`${section}.${field}`] ??
    FIELD_META[field] ?? {
      placement: "Debug drawer",
      notes: "No explicit recommendation yet.",
    }
  );
}

function categoryForField(
  section: string,
  field: string,
  rawAvailable: boolean,
): MappingCategory {
  if (!rawAvailable) return "UNKNOWN";
  const path = section === "top-level" ? field : `${section}.${field}`;
  return MAPPING_SPECS.find((spec) => spec.field === path)?.category ?? "UNKNOWN";
}

function rowsForObject(
  section: string,
  value: unknown,
  rawDebug: InspectorPayload["rawKognitosDebug"] | undefined,
): FieldRow[] {
  if (!isPlainObject(value)) return [];
  return Object.entries(value).map(([field, fieldValue]) => {
    const meta = fieldMeta(section, field);
    const displayFieldName = `${section}.${field}`;
    const spec = mappingSpecForField(displayFieldName);
    const rawRoot = spec?.field === "events" ? rawDebug?.eventsRaw : rawDebug?.exceptionRaw;
    const sourceFields =
      spec && rawRoot ? sourceFieldsForSpec(rawRoot, spec.rawPaths, "exceptionRaw") : [];
    const originalValue = sourceFields[0]?.value;
    const rawAvailable = Boolean(rawDebug);
    const category = categoryForField(section, field, rawAvailable);
    return {
      section,
      field,
      value: fieldValue,
      category,
      categoryDetails: buildCategoryDetails({
        category,
        displayFieldName,
        displayValue: fieldValue,
        originalFieldName: sourceFields[0]?.fieldName ?? spec?.rawSource,
        originalValue,
        sourceFields,
      }),
      placement: meta.placement,
      notes: meta.notes,
    };
  });
}

function topLevelRows(payload: InspectorPayload): FieldRow[] {
  return Object.entries(payload)
    .filter(([key]) => key !== "exception" && key !== "runContext" && key !== "events")
    .map(([field, value]) => {
      const meta = fieldMeta("", field);
      const rawAvailable = Boolean(payload.rawKognitosDebug);
      const category = categoryForField("top-level", field, rawAvailable);
      return {
        section: "top-level",
        field,
        value,
        category,
        categoryDetails: buildCategoryDetails({
          category,
          displayFieldName: field,
          displayValue: value,
        }),
        placement: meta.placement,
        notes: meta.notes,
      };
    });
}

function categoryVariant(category: MappingCategory) {
  if (category === "RAW_KOGNITOS") return "success";
  if (category === "APP_CREATED") return "secondary";
  if (category === "UNKNOWN") return "outline";
  return "warning";
}

function stateVariant(state: ExceptionStateUi) {
  if (state === "RESOLVED") return "success";
  if (state === "PENDING") return "warning";
  if (state === "ARCHIVED") return "secondary";
  return "outline";
}

function CategoryBadge({
  category,
  onClick,
  ariaLabel,
}: {
  category: MappingCategory;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const className =
    category === "FORMATTED"
      ? "border-transparent bg-success/5 text-success font-mono text-[10px]"
      : category === "RENAMED"
        ? "border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-300 font-mono text-[10px]"
        : "font-mono text-[10px]";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Badge
          variant={categoryVariant(category)}
          className={`${className} cursor-pointer transition-opacity hover:opacity-80`}
        >
          {category}
        </Badge>
      </button>
    );
  }
  return (
    <Badge variant={categoryVariant(category)} className={className}>
      {category}
    </Badge>
  );
}

function searchableText(row: ExceptionSummaryDto): string {
  return [
    row.title,
    row.exceptionId,
    row.runId,
    row.automationId,
    row.automationDisplayName,
    row.groupLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sortByNewest(a: ExceptionSummaryDto, b: ExceptionSummaryDto): number {
  const at = a.createTime ? Date.parse(a.createTime) : 0;
  const bt = b.createTime ? Date.parse(b.createTime) : 0;
  return bt - at;
}

function InlineValue({ value }: { value: unknown }) {
  const text = formatValue(value);
  const isLong = text.length > 180 || text.includes("\n");
  if (isLong) {
    return (
      <details className="min-w-0">
        <summary className="cursor-pointer whitespace-normal break-words text-xs text-foreground underline-offset-4 hover:underline">
          {text.slice(0, 180)}
          {text.length > 180 ? "..." : ""}
        </summary>
        <div className="mt-2 space-y-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void copyToClipboard(text)}
          >
            <Copy className="size-3" aria-hidden />
            Copy value
          </Button>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-xs leading-snug">
            {text}
          </pre>
        </div>
      </details>
    );
  }
  return <span className="whitespace-normal break-words text-sm">{text}</span>;
}

function FieldsTable({
  rows,
  onCategoryClick,
}: {
  rows: FieldRow[];
  onCategoryClick?: (details: CategoryDetails) => void;
}) {
  return (
    <div className="rounded-lg border border-border">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[8%] whitespace-normal">Section</TableHead>
            <TableHead className="w-[13%] whitespace-normal">Field</TableHead>
            <TableHead className="w-[31%] whitespace-normal">Value</TableHead>
            <TableHead className="w-[8%] whitespace-normal">Value type</TableHead>
            <TableHead className="w-[12%] whitespace-normal">Category</TableHead>
            <TableHead className="w-[13%] whitespace-normal">Recommended UI placement</TableHead>
            <TableHead className="w-[15%] whitespace-normal">Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.section}:${row.field}`}>
              <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                {row.section}
              </TableCell>
              <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                {row.field}
              </TableCell>
              <TableCell className="py-1.5">
                <InlineValue value={row.value} />
              </TableCell>
              <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                {valueType(row.value)}
              </TableCell>
              <TableCell className="py-1.5">
                <CategoryBadge
                  category={row.category}
                  onClick={
                    onCategoryClick
                      ? () => onCategoryClick(row.categoryDetails)
                      : undefined
                  }
                  ariaLabel={`View category details for ${row.section}.${row.field}`}
                />
              </TableCell>
              <TableCell className="whitespace-normal break-words py-1.5 text-sm">
                {row.placement}
              </TableCell>
              <TableCell className="whitespace-normal break-words py-1.5 text-sm text-muted-foreground">
                {row.notes}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EventDetail({ event }: { event: ExceptionEventDto }) {
  const detail = event.detail ?? "";
  if (!detail.trim()) return <span className="text-muted-foreground">-</span>;
  const formatted = maybePrettyJson(detail);
  const summary = formatted.length > 220 ? `${formatted.slice(0, 220)}...` : formatted;
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-sm text-foreground underline-offset-4 hover:underline">
        {summary}
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 p-3 text-xs leading-relaxed">
        {formatted}
      </pre>
    </details>
  );
}

function EventsTable({ events }: { events: ExceptionEventDto[] }) {
  const kinds = useMemo(
    () => Array.from(new Set(events.map((event) => event.kind))).sort(),
    [events],
  );
  const countsByKind = useMemo(
    () =>
      events.reduce<Record<string, number>>((acc, event) => {
        acc[event.kind] = (acc[event.kind] ?? 0) + 1;
        return acc;
      }, {}),
    [events],
  );
  const [kindFilter, setKindFilter] = useState("all");
  const visibleEvents = useMemo(
    () => events.filter((event) => kindFilter === "all" || event.kind === kindFilter),
    [events, kindFilter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium" htmlFor="event-kind-filter">
          Filter by kind
        </label>
        <select
          id="event-kind-filter"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
        >
          <option value="all">All kinds ({events.length})</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind} ({countsByKind[kind] ?? 0})
            </option>
          ))}
        </select>
      </div>
      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No events returned in the mapped browser response.
        </p>
      ) : (
        <div className="rounded-lg border border-border">
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[14%] whitespace-normal">createTime</TableHead>
                <TableHead className="w-[10%] whitespace-normal">kind</TableHead>
                <TableHead className="w-[24%] whitespace-normal">summary</TableHead>
                <TableHead className="w-[52%] whitespace-normal">detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEvents.map((event, index) => (
                <TableRow key={`${event.createTime ?? "event"}:${index}`}>
                  <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                    {event.createTime ?? "-"}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant="outline">{event.kind}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal break-words py-1.5 text-sm">
                    {event.summary}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <EventDetail event={event} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function buildMappingRows(payload: InspectorPayload): MappingRow[] {
  const rawDebug = payload.rawKognitosDebug;
  const rawUnavailable =
    "Raw Kognitos payload is not available, so source classification cannot be confirmed.";

  return MAPPING_SPECS.map((spec) => {
    const browserValue = getByPath(payload, spec.field);
    if (!rawDebug) {
      return {
        field: spec.field,
        browserValue,
        rawSource: "Unavailable",
        rawValue: undefined,
        transformation: "Cannot compare against raw Kognitos payload in this response.",
        category: "UNKNOWN",
        categoryDetails: buildCategoryDetails({
          category: "UNKNOWN",
          displayFieldName: spec.field,
          displayValue: browserValue,
          explanation:
            "Raw Kognitos payload is not available, so source classification cannot be confirmed.",
        }),
        notes: rawUnavailable,
      };
    }

    if (spec.field === "events") {
      const rawValue = firstAvailable(rawDebug.eventsRaw, spec.rawPaths);
      const category = rawValue === undefined ? "UNKNOWN" : spec.category;
      const sourceFields = sourceFieldsForSpec(rawDebug.eventsRaw, spec.rawPaths, "eventsRaw");
      return {
        field: spec.field,
        browserValue,
        rawSource: spec.rawSource,
        rawValue,
        transformation: spec.transformation,
        category,
        categoryDetails: buildCategoryDetails({
          category,
          displayFieldName: spec.field,
          displayValue: browserValue,
          originalFieldName: sourceFields[0]?.fieldName ?? spec.rawSource,
          originalValue: rawValue,
          sourceFields,
          explanation:
            rawValue === undefined
              ? "Raw Kognitos source field was not found in the debug payload, so source classification cannot be confirmed."
              : undefined,
        }),
        notes:
          rawValue === undefined
            ? "Raw Kognitos source field was not found in the debug payload, so source classification cannot be confirmed."
            : spec.notes,
      };
    }

    if (spec.rawPaths.length === 0) {
      return {
        field: spec.field,
        browserValue,
        rawSource: spec.rawSource,
        rawValue: undefined,
        transformation: spec.transformation,
        category: spec.category,
        categoryDetails: buildCategoryDetails({
          category: spec.category,
          displayFieldName: spec.field,
          displayValue: browserValue,
          originalFieldName: spec.rawSource,
        }),
        notes: spec.notes,
      };
    }

    const rawValue = firstAvailable(rawDebug.exceptionRaw, spec.rawPaths);
    const category = rawValue === undefined ? "UNKNOWN" : spec.category;
    const sourceFields = sourceFieldsForSpec(rawDebug.exceptionRaw, spec.rawPaths, "exceptionRaw");
    return {
      field: spec.field,
      browserValue,
      rawSource: spec.rawSource,
      rawValue,
      transformation: spec.transformation,
      category,
      categoryDetails: buildCategoryDetails({
        category,
        displayFieldName: spec.field,
        displayValue: browserValue,
        originalFieldName: sourceFields[0]?.fieldName ?? spec.rawSource,
        originalValue: rawValue,
        sourceFields,
        explanation:
          rawValue === undefined
            ? "Raw Kognitos source field was not found in the debug payload, so source classification cannot be confirmed."
            : undefined,
      }),
      notes:
        rawValue === undefined
          ? "Raw Kognitos source field was not found in the debug payload, so source classification cannot be confirmed."
          : spec.notes,
    };
  });
}

function MappingTable({
  payload,
  onCategoryClick,
}: {
  payload: InspectorPayload;
  onCategoryClick?: (details: CategoryDetails) => void;
}) {
  const rows = useMemo(() => buildMappingRows(payload), [payload]);
  return (
    <div className="space-y-3">
      {!payload.rawKognitosDebug ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Raw Kognitos payload is not available, so source classification cannot be
          confirmed.
        </p>
      ) : null}
      <div className="rounded-lg border border-border">
        <Table className="table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[11%] whitespace-normal">Browser response field</TableHead>
              <TableHead className="w-[21%] whitespace-normal">Browser response value</TableHead>
              <TableHead className="w-[12%] whitespace-normal">Raw Kognitos source field</TableHead>
              <TableHead className="w-[21%] whitespace-normal">Raw Kognitos value</TableHead>
              <TableHead className="w-[12%] whitespace-normal">Transformation</TableHead>
              <TableHead className="w-[10%] whitespace-normal">Category</TableHead>
              <TableHead className="w-[13%] whitespace-normal">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.field}>
                <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                  {row.field}
                </TableCell>
                <TableCell className="py-1.5">
                  <InlineValue value={row.browserValue} />
                </TableCell>
                <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                  {row.rawSource}
                </TableCell>
                <TableCell className="py-1.5">
                  <InlineValue value={row.rawValue} />
                </TableCell>
                <TableCell className="whitespace-normal break-words py-1.5 text-sm text-muted-foreground">
                  {row.transformation}
                </TableCell>
                <TableCell className="py-1.5">
                  <CategoryBadge
                    category={row.category}
                    onClick={
                      onCategoryClick
                        ? () => onCategoryClick(row.categoryDetails)
                        : undefined
                    }
                    ariaLabel={`View category details for ${row.field}`}
                  />
                </TableCell>
                <TableCell className="whitespace-normal break-words py-1.5 text-sm text-muted-foreground">
                  {row.notes}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function OverviewTab({
  payload,
  onCategoryClick,
}: {
  payload: InspectorPayload;
  onCategoryClick: (details: CategoryDetails) => void;
}) {
  const ex = payload.exception;
  const rawAvailable = Boolean(payload.rawKognitosDebug);
  const overviewRows: FieldRow[] = [
    {
      section: "exception",
      field: "title",
      value: ex.title,
      category: categoryForField("exception", "title", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.title",
        ex.title,
        payload,
        categoryForField("exception", "title", rawAvailable),
      ),
      ...fieldMeta("exception", "title"),
    },
    {
      section: "exception",
      field: "descriptionFull",
      value: ex.descriptionFull,
      category: categoryForField("exception", "descriptionFull", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.descriptionFull",
        ex.descriptionFull,
        payload,
        categoryForField("exception", "descriptionFull", rawAvailable),
      ),
      ...fieldMeta("exception", "descriptionFull"),
    },
    {
      section: "exception",
      field: "state",
      value: ex.state,
      category: categoryForField("exception", "state", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.state",
        ex.state,
        payload,
        categoryForField("exception", "state", rawAvailable),
      ),
      ...fieldMeta("exception", "state"),
    },
    {
      section: "exception",
      field: "groupLabel",
      value: ex.groupLabel,
      category: categoryForField("exception", "groupLabel", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.groupLabel",
        ex.groupLabel,
        payload,
        categoryForField("exception", "groupLabel", rawAvailable),
      ),
      ...fieldMeta("exception", "groupLabel"),
    },
    {
      section: "exception",
      field: "runId",
      value: ex.runId,
      category: categoryForField("exception", "runId", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.runId",
        ex.runId,
        payload,
        categoryForField("exception", "runId", rawAvailable),
      ),
      ...fieldMeta("exception", "runId"),
    },
    {
      section: "exception",
      field: "automationId",
      value: ex.automationId,
      category: categoryForField("exception", "automationId", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.automationId",
        ex.automationId,
        payload,
        categoryForField("exception", "automationId", rawAvailable),
      ),
      ...fieldMeta("exception", "automationId"),
    },
    {
      section: "exception",
      field: "createTime",
      value: ex.createTime,
      category: categoryForField("exception", "createTime", rawAvailable),
      categoryDetails: categoryDetailsFromSpec(
        "exception.createTime",
        ex.createTime,
        payload,
        categoryForField("exception", "createTime", rawAvailable),
      ),
      ...fieldMeta("exception", "createTime"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{ex.state}</Badge>
          <Badge variant="outline">{ex.groupLabel}</Badge>
          {payload.eventsAgentIdUsed ? (
            <Badge variant="secondary">agent: {payload.eventsAgentIdUsed}</Badge>
          ) : null}
        </div>
        <h2 className="mt-4 text-xl font-semibold">{ex.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {ex.descriptionFull ?? "No descriptionFull returned."}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Run ID</p>
            <p className="break-words font-mono text-sm">{ex.runId ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Automation ID</p>
            <p className="break-words font-mono text-sm">{ex.automationId ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="break-words font-mono text-sm">{ex.createTime ?? "-"}</p>
          </div>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Recommended UI Placement</h3>
        <FieldsTable rows={overviewRows} onCategoryClick={onCategoryClick} />
      </div>
    </div>
  );
}

function JsonBlock({
  title,
  value,
  copied,
  onCopy,
}: {
  title: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <details className="rounded-lg border border-border" open>
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
        {title}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.preventDefault();
            onCopy();
          }}
        >
          <Copy className="size-3.5" aria-hidden />
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </summary>
      <pre className="max-h-[42rem] overflow-auto border-t border-border bg-muted/50 p-4 text-xs leading-relaxed">
        {value}
      </pre>
    </details>
  );
}

function CategoryKey() {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-medium">Source Category Key</span>
        {CATEGORY_KEY.map((item) => (
          <span key={item.category} className="inline-flex max-w-xl items-center gap-1.5">
            <CategoryBadge category={item.category} />
            <span className="text-xs text-muted-foreground">{item.description}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DialogValue({ value }: { value: unknown }) {
  return (
    <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-xs leading-snug">
      {formatValue(value)}
    </pre>
  );
}

function FieldValuePanel({
  title,
  fieldName,
  value,
  unavailable,
}: {
  title: string;
  fieldName?: string;
  value?: unknown;
  unavailable?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{title}</p>
      {unavailable ? (
        <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="break-words font-mono text-xs text-muted-foreground">
            {fieldName ?? "-"}
          </p>
          <DialogValue value={value} />
        </div>
      )}
    </div>
  );
}

function SourceFieldsList({ fields }: { fields: SourceField[] }) {
  if (fields.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        Source data not available in this response.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <FieldValuePanel
          key={field.fieldName}
          title="Source field"
          fieldName={field.fieldName}
          value={field.value}
        />
      ))}
    </div>
  );
}

function CategoryDetailsDialog({
  details,
  onOpenChange,
}: {
  details: CategoryDetails | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(details);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        {details ? (
          <>
            <DialogHeader>
              <DialogTitle>Category details: {details.category}</DialogTitle>
              <DialogDescription>{details.explanation}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Category</span>
                <CategoryBadge category={details.category} />
              </div>

              {details.category === "DERIVED" ? (
                <div className="space-y-3">
                  <FieldValuePanel
                    title="Displayed data"
                    fieldName={details.displayFieldName}
                    value={details.displayValue}
                  />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Source data used</p>
                    <SourceFieldsList fields={details.sourceFields} />
                  </div>
                </div>
              ) : null}

              {details.category === "RENAMED" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <FieldValuePanel
                    title="Renamed data"
                    fieldName={details.displayFieldName}
                    value={details.displayValue}
                  />
                  <FieldValuePanel
                    title="Original data"
                    fieldName={details.originalFieldName}
                    value={details.originalValue}
                    unavailable={
                      details.originalValue === undefined
                        ? "Original source data not available in this response."
                        : undefined
                    }
                  />
                </div>
              ) : null}

              {details.category === "FORMATTED" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <FieldValuePanel
                    title="Original unformatted data"
                    fieldName={details.originalFieldName}
                    value={details.originalValue}
                    unavailable={
                      details.originalValue === undefined
                        ? "Original unformatted data not available in this response."
                        : undefined
                    }
                  />
                  <FieldValuePanel
                    title="Formatted data"
                    fieldName={details.displayFieldName}
                    value={details.displayValue}
                  />
                </div>
              ) : null}

              {details.category === "RAW_KOGNITOS" ? (
                <div className="space-y-3">
                  <FieldValuePanel
                    title="Raw Kognitos data"
                    fieldName={details.originalFieldName ?? details.displayFieldName}
                    value={details.originalValue ?? details.displayValue}
                  />
                  <p className="text-sm text-muted-foreground">
                    This value exists exactly as received from the raw Kognitos payload.
                  </p>
                </div>
              ) : null}

              {details.category === "APP_CREATED" ? (
                <div className="space-y-3">
                  <FieldValuePanel
                    title="App-created data"
                    fieldName={details.displayFieldName}
                    value={details.displayValue}
                  />
                  <p className="text-sm text-muted-foreground">
                    This value was created by the app and does not exist in the raw
                    Kognitos payload.
                  </p>
                </div>
              ) : null}

              {details.category === "UNKNOWN" ? (
                <div className="space-y-3">
                  <FieldValuePanel
                    title="Displayed data"
                    fieldName={details.displayFieldName}
                    value={details.displayValue}
                  />
                  <p className="text-sm text-muted-foreground">
                    The source could not be confirmed from the available response.
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ExceptionSelectorTable({
  rows,
  loading,
  selectedId,
  onSelect,
}: {
  rows: ExceptionSummaryDto[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (exceptionId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[8%] whitespace-normal">state</TableHead>
            <TableHead className="w-[10%] whitespace-normal">groupLabel</TableHead>
            <TableHead className="w-[30%] whitespace-normal">title / description</TableHead>
            <TableHead className="w-[14%] whitespace-normal">exceptionId</TableHead>
            <TableHead className="w-[12%] whitespace-normal">runId</TableHead>
            <TableHead className="w-[12%] whitespace-normal">automationId</TableHead>
            <TableHead className="w-[14%] whitespace-normal">createTime</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading exceptions...
                </span>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                No exceptions match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const selected = row.exceptionId === selectedId;
              return (
                <TableRow
                  key={row.exceptionId}
                  onClick={() => onSelect(row.exceptionId)}
                  className={
                    selected
                      ? "cursor-pointer bg-muted/70 hover:bg-muted"
                      : "cursor-pointer hover:bg-muted/50"
                  }
                >
                  <TableCell className="whitespace-normal break-words py-1.5">
                    <Badge variant={stateVariant(row.state)}>{row.state}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal break-words py-1.5">
                    <Badge variant="outline">{row.groupLabel}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal break-words py-1.5 text-sm">
                    {row.title}
                  </TableCell>
                  <TableCell className="whitespace-normal break-all py-1.5 font-mono text-xs">
                    {row.exceptionId}
                  </TableCell>
                  <TableCell className="whitespace-normal break-all py-1.5 font-mono text-xs">
                    {row.runId ?? "-"}
                  </TableCell>
                  <TableCell className="whitespace-normal break-all py-1.5 font-mono text-xs">
                    {row.automationId || "-"}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words py-1.5 font-mono text-xs">
                    {row.createTime ?? "-"}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* Clipboard may be unavailable in non-secure contexts. */
  }
}

export default function WorklistTestPage() {
  const [exceptionId, setExceptionId] = useState("");
  const [payload, setPayload] = useState<InspectorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<"mapped" | "raw" | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionSummaryDto[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listStateFilter, setListStateFilter] = useState<ListStateFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryDetails, setCategoryDetails] = useState<CategoryDetails | null>(null);

  const loadException = useCallback(async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) {
      setError("Enter an exception id to load.");
      return;
    }
    setLoading(true);
    setError(null);
    setCopiedTarget(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(trimmed)}?debug=1`,
      );
      const data = (await res.json()) as InspectorPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setPayload(data);
      setExceptionId(trimmed);
      setSelectedId(trimmed);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Failed to load exception detail");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      setListError(null);
      setPageIndex(0);
      setGroupFilter("all");
      try {
        const next: ExceptionSummaryDto[] = [];
        let pageToken: string | null = null;
        do {
          const params = new URLSearchParams({
            state: listStateFilter,
            page_size: String(LIST_FETCH_PAGE_SIZE),
          });
          if (pageToken) params.set("page_token", pageToken);
          const res = await fetch(`/api/kognitos/exceptions?${params.toString()}`);
          const data = (await res.json()) as {
            items?: ExceptionSummaryDto[];
            nextPageToken?: string | null;
            error?: string;
          };
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          next.push(...(data.items ?? []));
          pageToken = data.nextPageToken ?? null;
        } while (!cancelled && pageToken);

        if (cancelled) return;
        const sorted = next.sort(sortByNewest);
        setExceptions(sorted);
        const firstId = sorted[0]?.exceptionId;
        if (firstId) {
          setExceptionId(firstId);
          await loadException(firstId);
        } else {
          setPayload(null);
          setSelectedId(null);
        }
      } catch (e) {
        if (!cancelled) {
          setExceptions([]);
          setPayload(null);
          setSelectedId(null);
          setListError(e instanceof Error ? e.message : "Failed to load exceptions");
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listStateFilter, loadException]);

  const groupOptions = useMemo(
    () => Array.from(new Set(exceptions.map((row) => row.groupLabel))).sort(),
    [exceptions],
  );

  const filteredExceptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return exceptions.filter((row) => {
      if (groupFilter !== "all" && row.groupLabel !== groupFilter) return false;
      if (!query) return true;
      return searchableText(row).includes(query);
    });
  }, [exceptions, groupFilter, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredExceptions.length / LIST_PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedExceptions = useMemo(
    () =>
      filteredExceptions.slice(
        safePageIndex * LIST_PAGE_SIZE,
        safePageIndex * LIST_PAGE_SIZE + LIST_PAGE_SIZE,
      ),
    [filteredExceptions, safePageIndex],
  );

  const pageStart =
    filteredExceptions.length === 0 ? 0 : safePageIndex * LIST_PAGE_SIZE + 1;
  const pageEnd = Math.min((safePageIndex + 1) * LIST_PAGE_SIZE, filteredExceptions.length);

  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery, groupFilter]);

  const fieldRows = useMemo(() => {
    if (!payload) return [];
    return [
      ...rowsForObject("exception", payload.exception, payload.rawKognitosDebug),
      ...rowsForObject("runContext", payload.runContext, payload.rawKognitosDebug),
      ...topLevelRows(payload),
    ];
  }, [payload]);

  const mappedJson = useMemo(() => {
    if (!payload) return "";
    const mappedResponse: Partial<InspectorPayload> = { ...payload };
    delete mappedResponse.rawKognitosDebug;
    return JSON.stringify(mappedResponse, null, 2);
  }, [payload]);

  const rawJson = useMemo(() => {
    if (!payload?.rawKognitosDebug) return "";
    return JSON.stringify(payload.rawKognitosDebug, null, 2);
  }, [payload]);

  async function copyJson(target: "mapped" | "raw", value: string) {
    if (!value) return;
    await copyToClipboard(value);
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget(null), 1400);
  }

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Exception Data Inspector
        </h1>
        <p className="max-w-5xl text-sm text-muted-foreground">
          Developer view of the exception detail API response, mapped fields, events,
          run context, and raw JSON.
        </p>
      </div>

      <CategoryKey />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Exception Selector</CardTitle>
              <CardDescription>
                Search, filter, and click an exception row to load its detail response.
              </CardDescription>
            </div>
            {payload?.kognitosRunUrl ? (
              <Button variant="outline" size="sm" asChild>
                <a href={payload.kognitosRunUrl} target="_blank" rel="noreferrer">
                  Open in Kognitos
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(18rem,1fr)_12rem_14rem]">
            <div className="relative">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search title, description, exception ID, run ID, or automation ID..."
                aria-label="Search exceptions"
                className="pr-9"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear exception search"
                  className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            <select
              value={listStateFilter}
              onChange={(event) =>
                setListStateFilter(event.target.value as ListStateFilter)
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
              aria-label="Filter by state"
            >
              {STATE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
              aria-label="Filter by group label"
            >
              <option value="all">All groups</option>
              {groupOptions.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
          {listError ? <p className="text-sm text-destructive">{listError}</p> : null}
          <ExceptionSelectorTable
            rows={pagedExceptions}
            loading={listLoading}
            selectedId={selectedId}
            onSelect={(id) => void loadException(id)}
          />
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {pageStart}-{pageEnd} of {filteredExceptions.length} loaded exceptions.
              Sorted by createTime newest first.
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((cur) => Math.max(0, cur - 1))}
                disabled={safePageIndex === 0 || listLoading}
              >
                Previous
              </Button>
              <span className="font-mono text-xs">
                Page {safePageIndex + 1} / {pageCount}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((cur) => Math.min(pageCount - 1, cur + 1))}
                disabled={safePageIndex >= pageCount - 1 || listLoading}
              >
                Next
              </Button>
            </div>
          </div>
          {loading ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading selected exception detail...
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          Load by ID
        </summary>
        <div className="space-y-2 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            Fallback loader using the same internal detail route. The client never calls
            Kognitos directly.
          </p>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              value={exceptionId}
              onChange={(event) => setExceptionId(event.target.value)}
              placeholder="Paste an exception id..."
              className="font-mono"
              aria-label="Exception id"
            />
            <Button
              type="button"
              onClick={() => void loadException(exceptionId)}
              disabled={loading || !exceptionId.trim()}
            >
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Load
            </Button>
          </div>
        </div>
      </details>

      {!payload ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Load an exception to inspect the mapped browser response.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="mapping">Mapping</TabsTrigger>
            <TabsTrigger value="raw-json">Raw JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>
                  Human-readable exception summary and recommended UI placement.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OverviewTab
                  payload={payload}
                  onCategoryClick={setCategoryDetails}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fields">
            <Card>
              <CardHeader>
                <CardTitle>Fields</CardTitle>
                <CardDescription>
                  Mapped browser response fields from <code>exception</code>,{" "}
                  <code>runContext</code>, and top-level response fields. Events are
                  excluded here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldsTable
                  rows={fieldRows}
                  onCategoryClick={setCategoryDetails}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>Events</CardTitle>
                <CardDescription>
                  Full mapped event timeline. This debug page keeps all event kinds
                  visible, including thinking, tool, tool_result, user, agent, and
                  completion.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EventsTable events={payload.events} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mapping">
            <Card>
              <CardHeader>
                <CardTitle>Mapping</CardTitle>
                <CardDescription>
                  Compare mapped browser response fields to raw Kognitos source fields
                  when safe debug data is available.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MappingTable
                  payload={payload}
                  onCategoryClick={setCategoryDetails}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="raw-json">
            <Card>
              <CardHeader>
                <CardTitle>Raw JSON</CardTitle>
                <CardDescription>
                  Formatted, copyable JSON for the mapped browser response and raw
                  Kognitos debug payload when available.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <JsonBlock
                  title="Mapped browser response"
                  value={mappedJson}
                  copied={copiedTarget === "mapped"}
                  onCopy={() => void copyJson("mapped", mappedJson)}
                />
                {payload.rawKognitosDebug ? (
                  <JsonBlock
                    title="Raw Kognitos debug payload"
                    value={rawJson}
                    copied={copiedTarget === "raw"}
                    onCopy={() => void copyJson("raw", rawJson)}
                  />
                ) : (
                  <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                    Raw Kognitos payload is not included in this response. This page is
                    currently showing the mapped browser response only.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      <CategoryDetailsDialog
        details={categoryDetails}
        onOpenChange={(open) => {
          if (!open) setCategoryDetails(null);
        }}
      />
    </div>
  );
}
