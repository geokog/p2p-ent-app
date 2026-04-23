"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Download,
  Filter,
  Layers2,
  Maximize2,
  PanelRight,
  PanelRightClose,
  Search,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  formatConfidenceForTooltip,
  parseIdpInvoiceFieldHighlights,
  type IdPdfFieldHighlight,
} from "@/lib/kognitos/idp-invoice-field-highlights";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PageLayout = {
  baseW: number;
  baseH: number;
  cssW: number;
  cssH: number;
};

/** CSS pixel layout for the active zoom; same numbers drive canvas, mask, and bbox layer. */
function layoutForZoom(
  pageBase: { baseW: number; baseH: number } | null,
  maxCssWidth: number,
): PageLayout | null {
  if (!pageBase) return null;
  const cssW = Math.max(120, maxCssWidth);
  const scale = cssW / pageBase.baseW;
  const cssH = pageBase.baseH * scale;
  return {
    baseW: pageBase.baseW,
    baseH: pageBase.baseH,
    cssW,
    cssH,
  };
}

/** Same geometry as percentage-based highlight buttons, in CSS pixels for SVG mask cutouts. */
function highlightBboxRectCss(h: IdPdfFieldHighlight, L: PageLayout) {
  if (h.bboxCoordMode === "normalized") {
    return {
      x: h.bbox.x * L.cssW,
      y: h.bbox.y * L.cssH,
      w: h.bbox.width * L.cssW,
      h: h.bbox.height * L.cssH,
    };
  }
  return {
    x: (h.bbox.x / L.baseW) * L.cssW,
    y: (h.bbox.y / L.baseH) * L.cssH,
    w: (h.bbox.width / L.baseW) * L.cssW,
    h: (h.bbox.height / L.baseH) * L.cssH,
  };
}

function HighlightOverlay({
  h,
  baseW,
  baseH,
  isLinkedHover,
  isFocused,
  onLinkPointerEnter,
  onLinkPointerLeave,
  onLinkActivate,
}: {
  h: IdPdfFieldHighlight;
  baseW: number;
  baseH: number;
  isLinkedHover?: boolean;
  isFocused?: boolean;
  onLinkPointerEnter?: () => void;
  onLinkPointerLeave?: () => void;
  onLinkActivate?: () => void;
}) {
  const norm = h.bboxCoordMode === "normalized";
  const boxStyle = norm
    ? ({
        left: `${h.bbox.x * 100}%`,
        top: `${h.bbox.y * 100}%`,
        width: `${h.bbox.width * 100}%`,
        height: `${h.bbox.height * 100}%`,
      } as const)
    : ({
        left: `${(h.bbox.x / baseW) * 100}%`,
        top: `${(h.bbox.y / baseH) * 100}%`,
        width: `${(h.bbox.width / baseW) * 100}%`,
        height: `${(h.bbox.height / baseH) * 100}%`,
      } as const);
  const ariaLabel =
    h.value && h.value.trim()
      ? `${h.label}, page ${h.pageNumber}: ${h.value}`
      : `${h.label}, page ${h.pageNumber}`;
  return (
    <button
      type="button"
      data-field-highlight-id={h.id}
      className={cn(
        "absolute box-border cursor-pointer border border-solid bg-transparent opacity-100 outline-none",
        "rounded-[2px] transition-[border-color,box-shadow]",
        "shadow-none [box-shadow:none]",
        "pointer-events-auto",
        "focus-visible:border-[rgba(255,255,255,1)] focus-visible:ring-0 focus-visible:ring-offset-0",
        isFocused
          ? "z-[23] border-amber-200 shadow-[0_0_0_2px_rgba(253,230,138,0.75)] hover:border-amber-100 hover:shadow-[0_0_0_2px_rgba(253,230,138,0.85)]"
          : isLinkedHover
            ? "z-[22] border-sky-300 shadow-[0_0_0_2px_rgba(56,189,248,0.55)] hover:!border-emerald-300 hover:!shadow-[0_0_0_2px_rgba(110,231,183,0.5)]"
            : "z-[21] border-[rgba(255,255,255,0.85)] hover:!border-emerald-300 hover:!shadow-[0_0_0_2px_rgba(110,231,183,0.5)]",
      )}
      style={boxStyle}
      aria-label={ariaLabel}
      data-field-highlight-focused={isFocused ? "true" : undefined}
      onPointerEnter={onLinkPointerEnter}
      onPointerLeave={onLinkPointerLeave}
      onClick={() => {
        onLinkActivate?.();
      }}
    />
  );
}

function PdfPageThumbnail({
  pdf,
  pageNumber1,
  selected,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  pageNumber1: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel?: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    void (async () => {
      const page = await pdf.getPage(pageNumber1);
      if (cancelled) return;
      const baseVp = page.getViewport({ scale: 1 });
      const thumbMaxW = 52;
      const scale = thumbMaxW / baseVp.width;
      const vp = page.getViewport({ scale });
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        /* ignore */
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr =
        typeof window !== "undefined"
          ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
          : 1;
      const cssW = vp.width;
      const cssH = vp.height;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as const) : undefined,
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        /* ignore */
      }
    };
  }, [pdf, pageNumber1]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "mb-2 block w-full max-w-[60px] overflow-hidden rounded-sm bg-zinc-700/50 transition-opacity",
        selected ? "opacity-100 outline outline-1 outline-sky-400/70" : "opacity-90 hover:opacity-100",
      )}
      aria-label={`Page ${pageNumber1}`}
      aria-current={selected ? "page" : undefined}
    >
      <canvas ref={canvasRef} className="block h-auto w-full" />
    </button>
  );
}

function PdfPageWithHighlights({
  pdf,
  pageNumber1,
  maxCssWidth,
  pageHighlights,
  overlayEnabled,
  surface = "card",
  linkedHoverFieldId,
  focusedFieldId,
  onHighlightLinkPointerEnter,
  onHighlightLinkPointerLeave,
  onHighlightLinkActivate,
}: {
  pdf: PDFDocumentProxy;
  pageNumber1: number;
  maxCssWidth: number;
  pageHighlights: IdPdfFieldHighlight[];
  overlayEnabled: boolean;
  surface?: "card" | "workspace";
  linkedHoverFieldId?: string | null;
  focusedFieldId?: string | null;
  onHighlightLinkPointerEnter?: (id: string) => void;
  onHighlightLinkPointerLeave?: (id: string) => void;
  onHighlightLinkActivate?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** PDF user-space page size at scale 1; zoom only changes derived cssW/cssH via layoutForZoom. */
  const [pageBase, setPageBase] = useState<{ baseW: number; baseH: number } | null>(null);
  const renderTaskRef = useRef<{ cancel?: () => void } | null>(null);
  const rawMaskId = useId();
  const pageDimMaskId = `inv-dim-${pageNumber1}-${rawMaskId.replace(/:/g, "")}`;

  const layout = useMemo(
    () => layoutForZoom(pageBase, maxCssWidth),
    [pageBase, maxCssWidth],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageNumber1);
      if (cancelled) return;
      const baseVp = page.getViewport({ scale: 1 });
      setPageBase({ baseW: baseVp.width, baseH: baseVp.height });
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber1]);

  useLayoutEffect(() => {
    if (!layout) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const L = layout;
    void (async () => {
      const page = await pdf.getPage(pageNumber1);
      if (cancelled) return;
      const scale = L.cssW / L.baseW;
      const vp = page.getViewport({ scale });
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        /* ignore */
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr =
        typeof window !== "undefined"
          ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
          : 1;
      /** Match `layout` / overlay geometry exactly (vp can differ in float eps). */
      const cssW = L.cssW;
      const cssH = L.cssH;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as const) : undefined,
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled render */
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        /* ignore */
      }
    };
  }, [pdf, pageNumber1, layout]);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-white",
        surface === "workspace"
          ? ""
          : "mx-auto mb-6 rounded border border-border shadow-sm",
      )}
      style={
        layout
          ? { width: layout.cssW, height: layout.cssH }
          : { width: Math.max(120, maxCssWidth), minHeight: 200 }
      }
    >
      {!layout ? (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            surface === "workspace" ? "bg-zinc-100/90" : "bg-white/80",
          )}
        >
          <span
            className={cn(
              "text-sm",
              surface === "workspace" ? "text-zinc-600" : "text-muted-foreground",
            )}
          >
            Rendering page {pageNumber1}…
          </span>
        </div>
      ) : null}
      {layout && overlayEnabled ? (
        <svg
          className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-visible"
          aria-hidden
        >
          <defs>
            <mask
              id={pageDimMaskId}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={layout.cssW}
              height={layout.cssH}
            >
              <rect x={0} y={0} width={layout.cssW} height={layout.cssH} fill="white" />
              {pageHighlights.map((h) => {
                const r = highlightBboxRectCss(h, layout);
                if (!(r.w > 0 && r.h > 0)) return null;
                return (
                  <rect
                    key={h.id}
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill="black"
                    shapeRendering="crispEdges"
                  />
                );
              })}
            </mask>
          </defs>
        </svg>
      ) : null}
      <canvas
        ref={canvasRef}
        className={cn(
          "relative z-0 block max-h-none",
          surface === "workspace" ? "max-w-none" : "max-w-full",
        )}
        style={
          layout
            ? {
                verticalAlign: "top",
                width: layout.cssW,
                height: layout.cssH,
              }
            : { verticalAlign: "top" }
        }
      />
      {layout && overlayEnabled ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-[10] bg-[rgba(0,0,0,0.52)] opacity-100"
            aria-hidden
            style={{
              maskImage: `url(#${pageDimMaskId})`,
              WebkitMaskImage: `url(#${pageDimMaskId})`,
              maskSize: `${layout.cssW}px ${layout.cssH}px`,
              WebkitMaskSize: `${layout.cssW}px ${layout.cssH}px`,
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "0 0",
              WebkitMaskPosition: "0 0",
              maskMode: "luminance",
              backdropFilter: "none",
              filter: "none",
            }}
          />
          <div className="pointer-events-none absolute inset-0 z-[20] opacity-100">
            {pageHighlights.map((h) => (
              <HighlightOverlay
                key={h.id}
                h={h}
                baseW={layout.baseW}
                baseH={layout.baseH}
                isLinkedHover={linkedHoverFieldId === h.id}
                isFocused={focusedFieldId === h.id}
                onLinkPointerEnter={() => onHighlightLinkPointerEnter?.(h.id)}
                onLinkPointerLeave={() => onHighlightLinkPointerLeave?.(h.id)}
                onLinkActivate={() => onHighlightLinkActivate?.(h.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function fieldConfidencePercent(c: number | null): number | null {
  if (c == null || !Number.isFinite(c)) return null;
  if (c > 0 && c <= 1) return Math.round(c * 100);
  return Math.min(100, Math.max(0, Math.round(c)));
}

/** Three-bar signal-style confidence (green bars, height increases left→right). */
function ConfidenceSignalBars({ c }: { c: number | null }) {
  const pct = fieldConfidencePercent(c);
  const lit = pct == null ? 0 : pct >= 85 ? 3 : pct >= 55 ? 2 : 1;
  const label =
    pct == null ? "Confidence unknown" : `Confidence about ${pct}%`;
  return (
    <div
      className="flex h-4 shrink-0 items-end gap-[3px]"
      role="img"
      aria-label={label}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-[1px]",
            i < lit ? "bg-emerald-400" : "bg-zinc-700",
            i === 0 && "h-[5px]",
            i === 1 && "h-[9px]",
            i === 2 && "h-[13px]",
          )}
        />
      ))}
    </div>
  );
}

function confidenceMeterHoverText(c: number | null): string {
  const v = formatConfidenceForTooltip(c);
  if (v === "—") return "No confidence score";
  if (c != null && c > 0 && c <= 1) return `Confidence: ${v}%`;
  return `Confidence: ${v}`;
}

const reviewValueInputClass =
  "block w-full min-h-[2.5rem] max-h-28 overflow-y-auto rounded-md border border-zinc-700/50 bg-[#2a2a2c] px-3 py-2.5 text-left text-[13px] leading-snug text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [word-break:break-word] selection:bg-sky-500/25";

type PageFilter = "all" | number;

const SORT_LABELS = ["Page, then name", "Name A–Z", "Confidence (high first)"] as const;

function ExtractedFieldsReviewPanel({
  fields,
  linkedHoverFieldId,
  focusedFieldId,
  onRowPointerEnter,
  onRowPointerLeave,
  onRowActivate,
  scrollRef,
  onClose,
}: {
  fields: IdPdfFieldHighlight[];
  linkedHoverFieldId: string | null;
  focusedFieldId: string | null;
  onRowPointerEnter: (id: string) => void;
  onRowPointerLeave: (id: string) => void;
  onRowActivate: (id: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [pageFilter, setPageFilter] = useState<PageFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortIdx, setSortIdx] = useState(0);

  const uniquePages = useMemo(() => {
    const s = new Set<number>();
    for (const f of fields) s.add(f.pageNumber);
    return [...s].sort((a, b) => a - b);
  }, [fields]);

  const displayFields = useMemo(() => {
    let out =
      pageFilter === "all"
        ? [...fields]
        : fields.filter((f) => f.pageNumber === pageFilter);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          (f.value && f.value.toLowerCase().includes(q)),
      );
    }
    if (sortIdx === 1) {
      out.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
    } else if (sortIdx === 2) {
      out.sort((a, b) => {
        const pa = fieldConfidencePercent(a.confidence);
        const pb = fieldConfidencePercent(b.confidence);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pb - pa;
      });
    }
    return out;
  }, [fields, pageFilter, searchQuery, sortIdx]);

  const filterTriggerLabel =
    pageFilter === "all" ? "All fields" : `Page ${pageFilter} only`;

  return (
    <aside
      className="flex min-h-0 w-[min(100%,320px)] shrink-0 flex-col border-l border-zinc-800 bg-[#121212] text-zinc-200 sm:w-80"
      aria-label="All extracted fields"
    >
      <div className="shrink-0 border-b border-zinc-800/90 px-3 pb-2.5 pt-3">
        <div className="flex items-start justify-between gap-2 pr-1">
          <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-white">
            All extracted fields
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
              {fields.length} Field{fields.length === 1 ? "" : "s"}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={onClose}
                  aria-label="Close extracted fields panel"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Close panel</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 flex-1 justify-between gap-2 border-zinc-600/90 bg-transparent px-2.5 text-xs font-normal text-zinc-200 hover:bg-zinc-900 hover:text-white"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Filter className="size-3.5 shrink-0 opacity-80" aria-hidden />
                  <span className="truncate">{filterTriggerLabel}</span>
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-52 border-zinc-700 bg-zinc-950 text-zinc-100"
            >
              <DropdownMenuItem
                className="text-xs focus:bg-zinc-800 focus:text-white"
                onSelect={() => setPageFilter("all")}
              >
                All fields
              </DropdownMenuItem>
              {uniquePages.map((p) => (
                <DropdownMenuItem
                  key={p}
                  className="text-xs focus:bg-zinc-800 focus:text-white"
                  onSelect={() => setPageFilter(p)}
                >
                  Page {p} only
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  "size-8 shrink-0 border-zinc-600/90 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white",
                  searchOpen && "border-sky-500/50 bg-zinc-900 text-sky-200",
                )}
                aria-pressed={searchOpen}
                aria-label="Search fields"
                onClick={() => setSearchOpen((v) => !v)}
              >
                <Search className="size-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 shrink-0 border-zinc-600/90 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white"
                aria-label={`Sort: ${SORT_LABELS[sortIdx % 3]}`}
                onClick={() => setSortIdx((i) => (i + 1) % 3)}
              >
                <ArrowDownUp className="size-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{SORT_LABELS[sortIdx % 3]}</TooltipContent>
          </Tooltip>
        </div>
        {searchOpen ? (
          <div className="mt-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name or value…"
              className="h-8 border-zinc-600/90 bg-zinc-950/80 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:border-zinc-500 focus-visible:ring-sky-500/30"
            />
          </div>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4"
      >
        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-700/80 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-500">
            No extracted-field rows in this run&apos;s IDP output.
          </p>
        ) : displayFields.length === 0 ? (
          <p className="text-center text-xs text-zinc-500">No fields match the current filter.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {displayFields.map((h) => {
              const rowHover = linkedHoverFieldId === h.id;
              const rowFocus = focusedFieldId === h.id;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    data-extracted-field-row={h.id}
                    className={cn(
                      "w-full rounded-md text-left transition-colors",
                      "hover:bg-white/[0.04]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212]",
                      rowHover && "bg-sky-500/[0.1]",
                      rowFocus && "bg-sky-500/10 ring-1 ring-inset ring-sky-400/30",
                    )}
                    onPointerEnter={() => onRowPointerEnter(h.id)}
                    onPointerLeave={() => onRowPointerLeave(h.id)}
                    onClick={() => onRowActivate(h.id)}
                  >
                    <div className="flex items-center gap-2 pr-0.5">
                      <Type
                        className="size-3.5 shrink-0 text-zinc-500"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 break-words font-mono text-[13px] text-zinc-100">
                        {h.label}
                      </span>
                      <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">
                        p{h.pageNumber}
                      </span>
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex shrink-0 cursor-default">
                            <ConfidenceSignalBars c={h.confidence} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="border-zinc-600 bg-zinc-950 text-xs text-zinc-100"
                        >
                          {confidenceMeterHoverText(h.confidence)}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div
                      className={cn(
                        reviewValueInputClass,
                        "mt-2.5 select-text transition-[border-color,box-shadow,background-color]",
                        rowHover &&
                          "border-sky-500/60 bg-sky-500/[0.16] shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35)]",
                      )}
                    >
                      {h.value || "—"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

type Props = {
  pdfUrl: string;
  runId: string;
};

function downloadFilenameForRun(runId: string) {
  const safe = runId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  return safe ? `invoice-${safe}.pdf` : "invoice.pdf";
}

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.45;
const ZOOM_STEP = 1.12;

/**
 * Matches `ExtractedFieldsReviewPanel` width (`sm:w-80` / `w-[min(100%,320px)]`).
 * While the panel is closed, the workspace flex column is still full-width; subtract this so
 * the PDF opens at the same fit width as after the panel has been opened once.
 */
const EXTRACTED_FIELDS_PANEL_LAYOUT_PX = 320;

export function InvoicePdfHighlightViewer({ pdfUrl, runId }: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const fieldsPanelScrollRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [showFieldOverlays, setShowFieldOverlays] = useState(true);
  const [fitMaxCssWidth, setFitMaxCssWidth] = useState(640);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [parsedHighlights, setParsedHighlights] = useState<IdPdfFieldHighlight[]>([]);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [linkedHoverFieldId, setLinkedHoverFieldId] = useState<string | null>(null);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [fieldsPanelOpen, setFieldsPanelOpen] = useState(false);
  const fieldsPanelOpenRef = useRef(fieldsPanelOpen);
  fieldsPanelOpenRef.current = fieldsPanelOpen;
  /**
   * Fit width measured while the right panel is open (narrow workspace), or reserved equivalent
   * while closed (see `EXTRACTED_FIELDS_PANEL_LAYOUT_PX`). When the panel closes, we keep this
   * cap and only center — document size stays the same until zoom changes.
   */
  const lockedFitMaxRef = useRef<number | null>(null);

  const applyWorkspaceFit = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const panelOpen = fieldsPanelOpenRef.current;
    const reserve = panelOpen ? 0 : EXTRACTED_FIELDS_PANEL_LAYOUT_PX;
    const raw = Math.max(220, Math.floor(el.clientWidth - 80 - reserve));
    if (panelOpen) {
      lockedFitMaxRef.current = raw;
      setFitMaxCssWidth(raw);
    } else {
      const cap = lockedFitMaxRef.current;
      setFitMaxCssWidth(cap != null ? Math.min(cap, raw) : raw);
    }
  }, []);

  const displayMaxCssWidth = Math.round(
    Math.min(2800, Math.max(180, fitMaxCssWidth * zoomLevel)),
  );

  useEffect(() => {
    if (!pdfDoc) return;
    let ro: ResizeObserver | null = null;
    const id = requestAnimationFrame(() => {
      if (!workspaceRef.current) return;
      applyWorkspaceFit();
      ro = new ResizeObserver(() => {
        applyWorkspaceFit();
      });
      ro.observe(workspaceRef.current);
    });
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
  }, [pdfDoc, applyWorkspaceFit]);

  useLayoutEffect(() => {
    if (!pdfDoc) return;
    applyWorkspaceFit();
  }, [fieldsPanelOpen, pdfDoc, applyWorkspaceFit]);

  useEffect(() => {
    lockedFitMaxRef.current = null;
    setActivePage(1);
    setZoomLevel(1);
    setLinkedHoverFieldId(null);
    setFocusedFieldId(null);
    setFieldsPanelOpen(false);
  }, [pdfUrl]);

  useEffect(() => {
    lockedFitMaxRef.current = null;
    setLinkedHoverFieldId(null);
    setFocusedFieldId(null);
    setFieldsPanelOpen(false);
  }, [runId]);

  useEffect(() => {
    if (!pdfDoc) return;
    setActivePage((p) => Math.min(Math.max(1, p), pdfDoc.numPages));
  }, [pdfDoc]);

  useEffect(() => {
    let cancelled = false;
    setPayloadError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/kognitos/runs/${encodeURIComponent(runId)}/payload`,
        );
        const json = (await res.json()) as { payload?: unknown; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setParsedHighlights([]);
          setPayloadError(json.error ?? "Could not load run payload.");
          return;
        }
        const p = json.payload;
        if (!p || typeof p !== "object" || Array.isArray(p)) {
          setParsedHighlights([]);
          return;
        }
        const rec = p as Record<string, unknown>;
        setParsedHighlights(parseIdpInvoiceFieldHighlights(rec));
      } catch {
        if (!cancelled) {
          setParsedHighlights([]);
          setPayloadError("Could not load run payload.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setPdfLoading(true);
    setPdfError(null);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const v = (pdfjs as { version?: string }).version ?? "4.10.38";
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
        const task = pdfjs.getDocument({ url: pdfUrl, withCredentials: false });
        const loaded = await task.promise;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        doc = loaded;
        setPdfDoc(loaded);
      } catch (e) {
        if (!cancelled) {
          setPdfDoc(null);
          setPdfError(e instanceof Error ? e.message : "Failed to load PDF.");
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [pdfUrl]);

  const byPage = (n: number) => parsedHighlights.filter((h) => h.pageNumber === n);

  const sortedFields = useMemo(
    () =>
      [...parsedHighlights].sort(
        (a, b) =>
          a.pageNumber - b.pageNumber ||
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      ),
    [parsedHighlights],
  );

  const onRowPointerEnter = useCallback((id: string) => {
    setLinkedHoverFieldId(id);
  }, []);

  const onRowPointerLeave = useCallback((id: string) => {
    setLinkedHoverFieldId((cur) => (cur === id ? null : cur));
  }, []);

  const onHighlightLinkPointerEnter = useCallback((id: string) => {
    setLinkedHoverFieldId(id);
  }, []);

  const onHighlightLinkPointerLeave = useCallback((id: string) => {
    setLinkedHoverFieldId((cur) => (cur === id ? null : cur));
  }, []);

  const onHighlightLinkActivate = useCallback(
    (id: string) => {
      const h = parsedHighlights.find((x) => x.id === id);
      if (h) setActivePage(h.pageNumber);
      setFocusedFieldId(id);
    },
    [parsedHighlights],
  );

  useEffect(() => {
    if (!focusedFieldId) return;
    const root = fieldsPanelScrollRef.current;
    if (!root) return;
    const row = root.querySelector(
      `[data-extracted-field-row="${CSS.escape(focusedFieldId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedFieldId]);

  useEffect(() => {
    if (!focusedFieldId || !workspaceRef.current) return;
    const h = parsedHighlights.find((x) => x.id === focusedFieldId);
    if (!h || h.pageNumber !== activePage) return;
    const raf = requestAnimationFrame(() => {
      workspaceRef.current
        ?.querySelector(`[data-field-highlight-id="${CSS.escape(focusedFieldId)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusedFieldId, activePage, parsedHighlights]);

  const handleDownloadPdf = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = downloadFilenameForRun(runId);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading(false);
    }
  }, [downloading, pdfUrl, runId]);

  const zoomOut = () => setZoomLevel((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP));
  const zoomIn = () => setZoomLevel((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP));
  const zoomFit = () => setZoomLevel(1);

  /** Bottom toolbar: ~15% smaller than default icon buttons (size-9 / size-4 icons). */
  const toolbarBtnClass =
    "h-[31px] w-[31px] min-h-[31px] min-w-[31px] shrink-0 text-zinc-700 hover:bg-zinc-200/90 hover:text-zinc-950";
  const toolbarIconClass = "size-[14px]";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 flex-col bg-[#323234]">
        {payloadError ? (
          <p className="shrink-0 px-4 py-2 text-xs text-amber-200">{payloadError}</p>
        ) : null}
        {pdfLoading ? (
          <p className="shrink-0 px-4 py-3 text-sm text-zinc-400">Loading PDF…</p>
        ) : null}
        {pdfError ? (
          <p className="shrink-0 px-4 py-3 text-sm text-red-300">{pdfError}</p>
        ) : null}
        {pdfDoc && !pdfError ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-row">
            <aside
              className="flex w-[76px] shrink-0 flex-col border-r border-white/[0.06] bg-[#1c1c1e] text-zinc-200"
              aria-label="Page thumbnails"
            >
              <div className="flex flex-1 flex-col items-center overflow-y-auto py-3 pl-1.5 pr-1">
                {Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1).map((pageNum) => (
                  <PdfPageThumbnail
                    key={pageNum}
                    pdf={pdfDoc}
                    pageNumber1={pageNum}
                    selected={pageNum === activePage}
                    onSelect={() => setActivePage(pageNum)}
                  />
                ))}
              </div>
            </aside>
            {/* Center column: PDF scrolls above; toolbar is a fixed strip below (not inside overflow). */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                ref={workspaceRef}
                className="relative min-h-0 min-w-0 flex-1 overflow-auto overflow-x-auto bg-[#323234]"
              >
                <div className="relative z-0 flex min-h-full w-full min-w-0 items-center justify-center px-10 pb-10 pt-10">
                  <PdfPageWithHighlights
                    key={activePage}
                    pdf={pdfDoc}
                    pageNumber1={activePage}
                    maxCssWidth={displayMaxCssWidth}
                    pageHighlights={byPage(activePage)}
                    overlayEnabled={showFieldOverlays}
                    surface="workspace"
                    linkedHoverFieldId={linkedHoverFieldId}
                    focusedFieldId={focusedFieldId}
                    onHighlightLinkPointerEnter={onHighlightLinkPointerEnter}
                    onHighlightLinkPointerLeave={onHighlightLinkPointerLeave}
                    onHighlightLinkActivate={onHighlightLinkActivate}
                  />
                </div>
              </div>
              <div className="pointer-events-none z-40 flex shrink-0 justify-center border-t border-white/[0.06] bg-[#323234] py-[0.6375rem]">
                <div
                  className={cn(
                    "pointer-events-auto flex items-center gap-0 rounded-full border px-[5px] py-[3px]",
                    showFieldOverlays
                      ? "border-zinc-300/90 bg-white shadow-lg shadow-black/20"
                      : "border-black/8 bg-white/93 shadow-md shadow-black/10 backdrop-blur-sm",
                  )}
                  role="toolbar"
                  aria-label="Document tools"
                >
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={toolbarBtnClass}
                          onClick={zoomOut}
                          disabled={zoomLevel <= ZOOM_MIN * 1.001}
                          aria-label="Zoom out"
                        >
                          <ZoomOut className={toolbarIconClass} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Zoom out</TooltipContent>
                    </Tooltip>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={toolbarBtnClass}
                          onClick={zoomIn}
                          disabled={zoomLevel >= ZOOM_MAX * 0.999}
                          aria-label="Zoom in"
                        >
                          <ZoomIn className={toolbarIconClass} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Zoom in</TooltipContent>
                    </Tooltip>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={toolbarBtnClass}
                          onClick={zoomFit}
                          aria-label="Fit to width"
                        >
                          <Maximize2 className={toolbarIconClass} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Fit to width</TooltipContent>
                    </Tooltip>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            toolbarBtnClass,
                            showFieldOverlays &&
                              "bg-sky-500/12 text-sky-900 hover:bg-sky-500/18 hover:text-sky-950",
                          )}
                          onClick={() => setShowFieldOverlays((v) => !v)}
                          aria-pressed={showFieldOverlays}
                          aria-label="Toggle field highlights"
                        >
                          <Layers2 className={toolbarIconClass} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Field highlights</TooltipContent>
                    </Tooltip>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={toolbarBtnClass}
                          disabled={downloading}
                          onClick={() => void handleDownloadPdf()}
                          aria-label="Download PDF"
                        >
                          <Download className={toolbarIconClass} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Download PDF</TooltipContent>
                    </Tooltip>
                    <div
                      className="mx-0 h-[17px] w-px shrink-0 self-center bg-zinc-400/55"
                      aria-hidden
                    />
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            toolbarBtnClass,
                            "rounded-md border border-zinc-400/75 bg-zinc-500/5 shadow-none",
                            fieldsPanelOpen &&
                              "border-zinc-500/90 bg-zinc-500/15 text-zinc-900",
                          )}
                          onClick={() => setFieldsPanelOpen((v) => !v)}
                          aria-pressed={fieldsPanelOpen}
                          aria-expanded={fieldsPanelOpen}
                          aria-label={
                            fieldsPanelOpen
                              ? "Hide extracted fields panel"
                              : "Show extracted fields panel"
                          }
                        >
                          {fieldsPanelOpen ? (
                            <PanelRightClose
                              className={toolbarIconClass}
                              strokeWidth={2}
                              aria-hidden
                            />
                          ) : (
                            <PanelRight
                              className={toolbarIconClass}
                              strokeWidth={2}
                              aria-hidden
                            />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {fieldsPanelOpen
                          ? "Hide extracted fields"
                          : "Show extracted fields"}
                      </TooltipContent>
                    </Tooltip>
                </div>
              </div>
            </div>
            {fieldsPanelOpen ? (
              <ExtractedFieldsReviewPanel
                key={runId}
                fields={sortedFields}
                linkedHoverFieldId={linkedHoverFieldId}
                focusedFieldId={focusedFieldId}
                onRowPointerEnter={onRowPointerEnter}
                onRowPointerLeave={onRowPointerLeave}
                onRowActivate={onHighlightLinkActivate}
                scrollRef={fieldsPanelScrollRef}
                onClose={() => setFieldsPanelOpen(false)}
              />
            ) : null}
          </div>
        ) : null}
        {!pdfLoading && !pdfError && pdfDoc && parsedHighlights.length === 0 ? (
          <p className="shrink-0 px-4 py-2 text-xs text-zinc-500">
            No extracted-field highlights were found in this run&apos;s IDP output.
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
