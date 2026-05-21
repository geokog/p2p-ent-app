"use client";

/**
 * PdfHighlightViewerV2
 *
 * A from-scratch implementation of the kognitos-plugin's document-preview
 * surface, written purely from the reference templates in
 * `skills/kognitos-app-development/references/document-preview.md`. Unlike
 * the in-repo `<InvoicePdfHighlightViewer />`, none of this file's
 * components are imported from or modeled on existing app viewers — every
 * sub-component below is a direct translation of the plugin template (or,
 * where the plugin only specifies rules without a template, an
 * implementation that satisfies those rules).
 *
 * Adapters this file is *allowed* to reuse, per the plugin's own
 * architecture rule ("Normalize the payload in an adapter, not in the UI;
 * the viewer consumes a flat FieldHighlight[]"):
 *
 *   - `parseIdpInvoiceFieldHighlights` (the IDP → flat-field parser)
 *   - `IdPdfFieldHighlight` (the parser's output type)
 *   - `formatConfidenceForTooltip`
 *   - `cn` UI utility
 *   - shadcn primitives (Tooltip, Input, etc.)
 *
 * Plugin sections this file maps to (search `references/document-preview.md`
 * for the headings):
 *
 *   - `## Window Chrome and Color Scheme` → root composition + dark zinc tokens
 *   - `## Page Rail (Multi-page Documents)` → `PageRail` + `PageThumbnail`
 *   - `## Render Lifecycle and Reset` → `useLayoutEffect`, render-task ref,
 *      `key={activePage}` on the page renderer, AbortController on payload
 *   - `## Document Positioning` → `layoutForZoom`, locked fit cap when panel open
 *   - `## Bottom Toolbar (Document Controls)` → `BottomToolbar`
 *   - `## Bounding Box Overlays` → `PdfPageOverlay`, `HighlightButton`
 *   - `## Right Panel — Extracted Values + Confidence` →
 *      `RightPanel`, `RightPanelToolbar`, `ConfidenceSignalBars`,
 *      `FieldRow` (the value chip is inlined per dashboard parity —
 *      see `reviewValueInputClass`)
 *   - `## IDP Payload Contract` → `chooseYAxisFlipForPage` + reused parser
 *   - `## State Coverage` → `pdfLoading`, `pdfError`, `payloadLoading`,
 *     `payloadError`, `payloadEmpty`, `ready`, `rendering-page`,
 *     `highlights-off`, `panel-collapsed`, `closing`
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Download,
  Filter,
  Info,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatConfidenceForTooltip,
  parseIdpInvoiceFieldHighlights,
  type IdPdfFieldHighlight,
} from "@/lib/kognitos/idp-invoice-field-highlights";
import { cn } from "@/lib/utils";

// =====================================================================
// Constants — pixel sizes are reference defaults from the plugin
// (`assets/app-review-checklist.md` final bullet); contrast hierarchy
// and relative width relationships are the parts that are contractual.
// =====================================================================

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.45;
const ZOOM_STEP = 1.12;

/** Dashboard parity: the canonical viewer's rail is `w-[76px]` with a
 * `#1c1c1e` background. The plugin's "~120px" guidance produces a
 * noticeably wider rail and a different palette; the dashboard's
 * compact rail is the user-visible target. */
const PAGE_RAIL_WIDTH_PX = 76;

/** Plugin: "Width matches the constant reserved by the document fit
 * measurement (typically ~320 px)". The document workspace subtracts
 * this even while the panel is collapsed, so toggling the panel does
 * not reflow the document. */
const RIGHT_PANEL_WIDTH_PX = 320;

/** Dashboard parity: thumbnails clamp at `max-w-[60px]` and render the
 * page bitmap at a `thumbMaxW = 52` source width before the wrapper's
 * `w-full` upscales them. */
const THUMBNAIL_MAX_CSS_WIDTH = 52;

/** Plugin: minimum bbox ~12px or ~1% of page width — whichever is larger. */
const MIN_BBOX_PX = 12;

/** Plugin: confidence buckets — `<55` low / `<85` medium / `≥85` high. */
const CONFIDENCE_LOW = 55;
const CONFIDENCE_MEDIUM = 85;

// =====================================================================
// Types
// =====================================================================

type PageLayout = {
  baseW: number;
  baseH: number;
  cssW: number;
  cssH: number;
};

type Props = {
  /**
   * Same-origin URL to the PDF bytes. The application's adapter layer
   * already implements the workspace-then-org Files API fallback chain
   * (plugin: `## Document Fetch and Payload Fetch` → `PDF bytes`); this
   * prop just hands the URL to `pdfjs.getDocument({ url })`.
   */
  pdfUrl: string;
  /**
   * Run id, used for two purposes per plugin guidance:
   *   1. Fetch the IDP payload at `/api/.../runs/{runId}/payload`.
   *   2. As the parent `key` on this component (`Reset Across Runs`)
   *      so all internal state and refs reset cleanly when the
   *      operator switches runs.
   */
  runId: string;
};

// =====================================================================
// Pure helpers — direct copies of the plugin reference templates
// =====================================================================

/**
 * Plugin: `## Document Positioning`. Single source of truth for layout —
 * canvas size, SVG mask viewBox, and overlay container all read these
 * numbers, so they pixel-align across zoom and resize.
 */
function layoutForZoom(
  pageBase: { baseW: number; baseH: number } | null,
  maxCssWidth: number,
): PageLayout | null {
  if (!pageBase) return null;
  const cssW = Math.max(120, maxCssWidth);
  const scale = cssW / pageBase.baseW;
  const cssH = pageBase.baseH * scale;
  return { baseW: pageBase.baseW, baseH: pageBase.baseH, cssW, cssH };
}

/**
 * Plugin: `## IDP Payload Contract` → `Y-axis convention`. Score how
 * much each candidate Y-axis convention overlaps the page rectangle,
 * pick the winning convention per page.
 */
function chooseYAxisFlipForPage(
  fieldsOnPage: IdPdfFieldHighlight[],
  pageRect: { width: number; height: number },
): "flip" | "noflip" {
  function overlap(flip: boolean): number {
    let area = 0;
    for (const f of fieldsOnPage) {
      const y = flip
        ? pageRect.height - f.bbox.y - f.bbox.height
        : f.bbox.y;
      const ix =
        Math.max(0, Math.min(pageRect.width, f.bbox.x + f.bbox.width)) -
        Math.max(0, f.bbox.x);
      const iy =
        Math.max(0, Math.min(pageRect.height, y + f.bbox.height)) -
        Math.max(0, y);
      area += Math.max(0, ix) * Math.max(0, iy);
    }
    return area;
  }
  return overlap(true) > overlap(false) ? "flip" : "noflip";
}

/**
 * Plugin: `## Bounding Box Overlays`. Returns the same geometry the
 * percentage-positioned overlay buttons use, but in CSS pixels for the
 * SVG mask cutouts. Branches on `bboxCoordMode`; both modes resolve to
 * the same percentage layout downstream.
 *
 * Note: the plugin references this helper but does not include its
 * source — it is implied by the surrounding rules. See feedback log.
 */
function highlightBboxRectCss(
  h: IdPdfFieldHighlight,
  layout: PageLayout,
  yFlip: "flip" | "noflip",
) {
  let x: number;
  let y: number;
  let w: number;
  let hgt: number;
  if (h.bboxCoordMode === "normalized") {
    x = h.bbox.x * layout.cssW;
    y = h.bbox.y * layout.cssH;
    w = h.bbox.width * layout.cssW;
    hgt = h.bbox.height * layout.cssH;
  } else {
    x = (h.bbox.x / layout.baseW) * layout.cssW;
    y = (h.bbox.y / layout.baseH) * layout.cssH;
    w = (h.bbox.width / layout.baseW) * layout.cssW;
    hgt = (h.bbox.height / layout.baseH) * layout.cssH;
    if (yFlip === "flip") {
      y = layout.cssH - y - hgt;
    }
  }
  const minPx = Math.max(MIN_BBOX_PX, layout.cssW * 0.01);
  if (w < minPx) {
    x -= (minPx - w) / 2;
    w = minPx;
  }
  if (hgt < minPx) {
    y -= (minPx - hgt) / 2;
    hgt = minPx;
  }
  return { x, y, w, h: hgt };
}

/**
 * Plugin: `## Right Panel` → `Field Labels`.
 * Title-case a snake_case identifier (`vendor_invoice_number` →
 * `Vendor Invoice Number`).
 */
function humanizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Plugin bucketing rule. `c` may be fractional (0–1) or already in 0–100.
 */
function confidenceBucket(c: number | null): {
  norm: number | null;
  bucket: "low" | "medium" | "high" | "none";
  lit: number;
} {
  if (c == null || !Number.isFinite(c)) {
    return { norm: null, bucket: "none", lit: 0 };
  }
  const norm = c <= 1 ? c * 100 : c;
  if (norm < CONFIDENCE_LOW) return { norm, bucket: "low", lit: 1 };
  if (norm < CONFIDENCE_MEDIUM) return { norm, bucket: "medium", lit: 2 };
  return { norm, bucket: "high", lit: 3 };
}

/** Dashboard parity helper: returns 0–100 percent or `null` when the
 *  source confidence is null/non-finite. Used by both the meter
 *  rendering and the meter tooltip text below. */
function fieldConfidencePercent(c: number | null): number | null {
  if (c == null || !Number.isFinite(c)) return null;
  if (c > 0 && c <= 1) return Math.round(c * 100);
  return Math.min(100, Math.max(0, Math.round(c)));
}

function confidenceMeterHoverText(c: number | null): string {
  const v = formatConfidenceForTooltip(c);
  if (v === "—") return "No confidence score";
  if (c != null && c > 0 && c <= 1) return `Confidence: ${v}%`;
  return `Confidence: ${v}`;
}

/** Dashboard's read-only value-chip class (used as the "value input"
 *  appearance inside each field row). The plugin template owns this as
 *  a separate `<ValueChip>` component; the dashboard inlines it as a
 *  `div` so the row's hover treatment can decorate the same surface
 *  via additional classes (sky-tinted border + background) without a
 *  child component re-spreading props. */
const reviewValueInputClass =
  "block w-full min-h-[2.5rem] max-h-28 overflow-y-auto rounded-md border border-zinc-700/50 bg-[#2a2a2c] px-3 py-2.5 text-left text-[13px] leading-snug text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [word-break:break-word] selection:bg-sky-500/25";

/** Dashboard cycles through three sort modes; tooltips read the labels. */
const SORT_LABELS = [
  "Page, then name",
  "Name A–Z",
  "Confidence (high first)",
] as const;

// =====================================================================
// Confidence signal bars — direct copy of plugin reference template,
// adapted to use the existing adapter's `IdPdfFieldHighlight.confidence`
// value (the bucketing math is the plugin's contract verbatim).
// =====================================================================

function ConfidenceSignalBars({ c }: { c: number | null }) {
  // Dashboard parity: the canonical viewer fills lit bars with a single
  // emerald tone (no rose / amber bucket-based color shift). Bar count
  // alone communicates confidence level — color only signals "lit vs.
  // unlit", which the user reads at a glance without parsing buckets.
  const { norm, lit } = confidenceBucket(c);
  const label =
    norm == null
      ? "Confidence unknown"
      : c != null && c <= 1
        ? `Confidence about ${Math.round(norm)}%`
        : `Confidence about ${Math.round(norm)}`;
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

// =====================================================================
// Page thumbnail — dashboard-style. The plugin template wires an
// IntersectionObserver around the canvas so thumbnails render lazily,
// but the dashboard renders all pages eagerly because in practice these
// documents have a small page count and the rail is always visible.
// Eager rendering keeps thumbnail timing deterministic on page swaps.
// =====================================================================

function PageThumbnail({
  pdf,
  pageNumber,
  selected,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
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
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const baseVp = page.getViewport({ scale: 1 });
      const scale = THUMBNAIL_MAX_CSS_WIDTH / baseVp.width;
      const vp = page.getViewport({ scale });
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        /* ignore */
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Plugin: thumbnails cap DPR at ~2.
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
        transform:
          dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as unknown as number[]) : undefined,
      }) as unknown as { cancel: () => void; promise: Promise<void> };
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* RenderingCancelledException is expected control flow */
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
  }, [pdf, pageNumber]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "mb-2 block w-full max-w-[60px] overflow-hidden rounded-sm bg-zinc-700/50 transition-opacity",
        selected
          ? "opacity-100 outline outline-1 outline-sky-400/70"
          : "opacity-90 hover:opacity-100",
      )}
      aria-label={`Page ${pageNumber}`}
      aria-current={selected ? "page" : undefined}
    >
      <canvas ref={canvasRef} className="block h-auto w-full" />
    </button>
  );
}

// =====================================================================
// Page rail — dashboard parity. The plugin template emphasizes a per-
// thumbnail caption ("page N") and a field-count badge; the canonical
// viewer drops both for visual density and lets the thumbnail itself
// carry selection state via an outline. The `fieldsByPage` parameter
// is intentionally retained on the call signature for API stability
// even though the dashboard rail does not surface a count badge.
// =====================================================================

function PageRail({
  pdf,
  pages,
  activePage,
  setActivePage,
}: {
  pdf: PDFDocumentProxy;
  pages: number;
  activePage: number;
  setActivePage: (p: number) => void;
  fieldsByPage: Record<number, IdPdfFieldHighlight[] | undefined>;
}) {
  return (
    <aside
      aria-label="Page thumbnails"
      className="flex shrink-0 flex-col border-r border-white/[0.06] bg-[#1c1c1e] text-zinc-200"
      style={{ width: PAGE_RAIL_WIDTH_PX }}
    >
      <div className="flex flex-1 flex-col items-center overflow-y-auto py-3 pl-1.5 pr-1">
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <PageThumbnail
            key={p}
            pdf={pdf}
            pageNumber={p}
            selected={p === activePage}
            onSelect={() => setActivePage(p)}
          />
        ))}
      </div>
    </aside>
  );
}

// =====================================================================
// Highlight button — the plugin describes the three z-stacked visual
// states (idle / linked-hover / focused) and the contract on background
// color (transparent), but does not include a self-contained class
// recipe. See feedback log entry "Bounding Box Overlays section omits
// class-state recipe".
// =====================================================================

function HighlightButton({
  h,
  layout,
  yFlip,
  isLinkedHover,
  isFocused,
  onLinkedHoverEnter,
  onLinkedHoverLeave,
  onActivate,
}: {
  h: IdPdfFieldHighlight;
  layout: PageLayout;
  yFlip: "flip" | "noflip";
  isLinkedHover: boolean;
  isFocused: boolean;
  onLinkedHoverEnter: (id: string) => void;
  onLinkedHoverLeave: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const r = highlightBboxRectCss(h, layout, yFlip);
  const ariaLabel =
    h.value && h.value.trim()
      ? `${h.label}, page ${h.pageNumber}: ${h.value}`
      : `${h.label}, page ${h.pageNumber}`;
  return (
    <button
      type="button"
      data-field-box-id={h.id}
      aria-label={ariaLabel}
      title={`${humanizeFieldName(h.label)} — ${formatConfidenceForTooltip(h.confidence)}`}
      onPointerEnter={() => onLinkedHoverEnter(h.id)}
      onPointerLeave={() => onLinkedHoverLeave(h.id)}
      onClickCapture={() => onActivate(h.id)}
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
      }}
      data-field-highlight-focused={isFocused ? "true" : undefined}
      // Dashboard parity: the canonical viewer expresses bbox state
      // entirely through `border-color` + `box-shadow` rings rather
      // than the plugin template's `outline` + `outline-color`.
      // Outline-driven rings paint a 1px line that doesn't compose with
      // the border the way the box-shadow ring does (the dashboard's
      // hover ring needs a solid 2px halo whose color sits *outside*
      // the border, not on top of it). The dashboard also adopts an
      // emerald-300 hover color in the idle/linked-hover states; this
      // is the single visual signal that distinguishes "the cursor is
      // on this exact bbox" from "this bbox is the linked partner of
      // a row hover elsewhere".
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
    />
  );
}

// =====================================================================
// Combined canvas + mask + overlay — direct copy of the plugin's
// `PdfPageOverlay` template, plus the canvas mount + render-task
// cancellation pattern from `## Render Lifecycle and Reset`.
// =====================================================================

function PdfPageWithHighlights({
  pdf,
  pageNumber1,
  maxCssWidth,
  highlights,
  highlightsOn,
  linkedHoverFieldId,
  focusedFieldId,
  onLinkedHoverEnter,
  onLinkedHoverLeave,
  onActivate,
}: {
  pdf: PDFDocumentProxy;
  pageNumber1: number;
  maxCssWidth: number;
  highlights: IdPdfFieldHighlight[];
  highlightsOn: boolean;
  linkedHoverFieldId: string | null;
  focusedFieldId: string | null;
  onLinkedHoverEnter: (id: string) => void;
  onLinkedHoverLeave: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{
    cancel: () => void;
    promise: Promise<void>;
  } | null>(null);
  const [pageBase, setPageBase] = useState<{
    baseW: number;
    baseH: number;
  } | null>(null);

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

  const layout = useMemo(
    () => layoutForZoom(pageBase, maxCssWidth),
    [pageBase, maxCssWidth],
  );

  useLayoutEffect(() => {
    if (!layout) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      // Plugin: tear down any in-flight render before starting a new one,
      // otherwise PDF.js throws "Cannot use the same canvas during
      // multiple render() operations".
      const prev = renderTaskRef.current;
      if (prev) {
        try {
          prev.cancel();
        } catch {
          /* noop */
        }
        try {
          await prev.promise;
        } catch {
          /* RenderingCancelledException is expected control flow */
        }
        renderTaskRef.current = null;
      }
      if (cancelled) return;

      const page = await pdf.getPage(pageNumber1);
      if (cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const scale = layout.cssW / layout.baseW;
      const vp = page.getViewport({ scale });
      const dpr =
        typeof window !== "undefined"
          ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
          : 1;
      canvas.width = Math.max(1, Math.floor(layout.cssW * dpr));
      canvas.height = Math.max(1, Math.floor(layout.cssH * dpr));
      canvas.style.width = `${layout.cssW}px`;
      canvas.style.height = `${layout.cssH}px`;

      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform:
          dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as unknown as number[]) : undefined,
      }) as unknown as { cancel: () => void; promise: Promise<void> };
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* RenderingCancelledException */
      }
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    })();
    return () => {
      cancelled = true;
      const t = renderTaskRef.current;
      if (t) {
        try {
          t.cancel();
        } catch {
          /* noop */
        }
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber1, layout]);

  const yFlip = useMemo<"flip" | "noflip">(() => {
    if (!layout) return "noflip";
    // Per plugin contract, only PDF-points bboxes need flip resolution;
    // normalized bboxes are top-left already.
    const pdfPointFields = highlights.filter(
      (h) => h.bboxCoordMode === "pdf_points",
    );
    if (pdfPointFields.length === 0) return "noflip";
    return chooseYAxisFlipForPage(pdfPointFields, {
      width: layout.baseW,
      height: layout.baseH,
    });
  }, [highlights, layout]);

  // Plugin: SVG mask ids generated via `useId()` and `:`-stripped so two
  // dialogs / hydration don't share `url(#…)` references.
  const rawId = useId();
  const maskId = `inv-dim-${rawId.replace(/:/g, "")}`;

  return (
    <div
      style={{
        ...(layout
          ? { width: layout.cssW, height: layout.cssH }
          : { width: maxCssWidth, minHeight: 200 }),
        isolation: "isolate",
      }}
      className="relative"
    >
      {!layout ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
          Rendering page {pageNumber1}…
        </div>
      ) : null}
      <canvas ref={canvasRef} className="block" />
      {layout && highlightsOn && highlights.length > 0 ? (
        <>
          <svg
            className="pointer-events-none absolute h-0 w-0 overflow-visible"
            aria-hidden
          >
            <defs>
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={layout.cssW}
                height={layout.cssH}
              >
                <rect
                  width={layout.cssW}
                  height={layout.cssH}
                  fill="white"
                />
                {highlights.map((h) => {
                  const r = highlightBboxRectCss(h, layout, yFlip);
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
          <div
            className="pointer-events-none absolute inset-0 z-[10] bg-[rgba(0,0,0,0.52)] opacity-100"
            aria-hidden
            style={{
              maskImage: `url(#${maskId})`,
              WebkitMaskImage: `url(#${maskId})`,
              // Dashboard parity: explicit `mask-size`, `mask-repeat`,
              // and `mask-position` (with WebKit-prefixed pairs) prevent
              // the SVG mask from being tiled or scaled when an
              // ancestor stacking-context exposes the mask container at
              // a different rect than the dim layer. The plugin
              // template omitted these and the mask occasionally
              // re-tiled on zoom changes.
              maskSize: `${layout.cssW}px ${layout.cssH}px`,
              WebkitMaskSize: `${layout.cssW}px ${layout.cssH}px`,
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "0 0",
              WebkitMaskPosition: "0 0",
              maskMode: "luminance",
              // Defensive resets — some Tailwind plugins inject
              // `backdrop-filter` / `filter` defaults at higher specificity.
              backdropFilter: "none",
              filter: "none",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 z-[20]"
            style={{ transform: "translateZ(0)" }}
          >
            {highlights.map((h) => (
              <HighlightButton
                key={h.id}
                h={h}
                layout={layout}
                yFlip={yFlip}
                isLinkedHover={linkedHoverFieldId === h.id}
                isFocused={focusedFieldId === h.id}
                onLinkedHoverEnter={onLinkedHoverEnter}
                onLinkedHoverLeave={onLinkedHoverLeave}
                onActivate={onActivate}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// =====================================================================
// Bottom toolbar — dashboard parity. The plugin guidance is only
// "square ~31×31 buttons with a `pointer-events-none` container"; the
// dashboard expresses that as a white pill (sky-tinted when highlights
// are on, white-93 + backdrop-blur when off), shadcn `<Button>`s in
// `variant="ghost"`, `lucide` `Layers2` for the highlight toggle (the
// plugin template uses `Type`, but `Layers2` reads as "show layers"),
// `side="top"` tooltips so they don't clip on the workspace's bottom
// edge, and a panel-toggle that adopts an `outline` look when closed
// and an `active` (filled) look when open. A vertical divider sits
// between the document tools and the panel toggle so it visually
// reads as a separate control group.
// =====================================================================

/** Bottom toolbar: ~15% smaller than default icon buttons. */
const toolbarBtnClass =
  "h-[31px] w-[31px] min-h-[31px] min-w-[31px] shrink-0 text-zinc-700 hover:bg-zinc-200/90 hover:text-zinc-950";
const toolbarIconClass = "size-[14px]";

function BottomToolbar({
  zoomLevel,
  setZoomLevel,
  resetZoom,
  highlightsOn,
  setHighlightsOn,
  panelOpen,
  setPanelOpen,
  onDownload,
  downloading,
}: {
  zoomLevel: number;
  setZoomLevel: (z: number) => void;
  resetZoom: () => void;
  highlightsOn: boolean;
  setHighlightsOn: (on: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const minZoom = zoomLevel <= ZOOM_MIN * 1.001;
  const maxZoom = zoomLevel >= ZOOM_MAX * 0.999;
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-0 rounded-full border px-[5px] py-[3px]",
        highlightsOn
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
            disabled={minZoom}
            onClick={() =>
              setZoomLevel(Math.max(ZOOM_MIN, zoomLevel / ZOOM_STEP))
            }
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
            disabled={maxZoom}
            onClick={() =>
              setZoomLevel(Math.min(ZOOM_MAX, zoomLevel * ZOOM_STEP))
            }
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
            onClick={resetZoom}
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
              highlightsOn &&
                "bg-sky-500/12 text-sky-900 hover:bg-sky-500/18 hover:text-sky-950",
            )}
            onClick={() => setHighlightsOn(!highlightsOn)}
            aria-pressed={highlightsOn}
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
            onClick={onDownload}
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
              panelOpen &&
                "border-zinc-500/90 bg-zinc-500/15 text-zinc-900",
            )}
            onClick={() => setPanelOpen(!panelOpen)}
            aria-pressed={panelOpen}
            aria-expanded={panelOpen}
            aria-label={
              panelOpen
                ? "Hide extracted fields panel"
                : "Show extracted fields panel"
            }
          >
            {panelOpen ? (
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
          {panelOpen ? "Hide extracted fields" : "Show extracted fields"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// =====================================================================
// Field row — direct copy of plugin `### Field Row Layout`.
// =====================================================================

function FieldRow({
  h,
  isLinkedHover,
  isFocused,
  onLinkedHoverEnter,
  onLinkedHoverLeave,
  onActivate,
}: {
  h: IdPdfFieldHighlight;
  isLinkedHover: boolean;
  isFocused: boolean;
  onLinkedHoverEnter: (id: string) => void;
  onLinkedHoverLeave: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  // Dashboard parity: rows render the snake_case identifier in mono only
  // (no humanized companion line — humanization belongs to tooltips on
  // chrome controls, not to the row label itself), pair the row's
  // hover with a sky-tinted decoration on the value chip rather than
  // a generic `bg-white/[0.03]` button hover, and wrap the confidence
  // meter in a `Tooltip` so the user can confirm the numeric value.
  return (
    <li data-field-row-id={h.id}>
      <button
        type="button"
        data-extracted-field-row={h.id}
        className={cn(
          "w-full rounded-md text-left transition-colors",
          "hover:bg-white/[0.04]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212]",
          isLinkedHover && "bg-sky-500/[0.1]",
          isFocused && "bg-sky-500/10 ring-1 ring-inset ring-sky-400/30",
        )}
        onPointerEnter={() => onLinkedHoverEnter(h.id)}
        onPointerLeave={() => onLinkedHoverLeave(h.id)}
        onClickCapture={() => onActivate(h.id)}
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
            isLinkedHover &&
              "border-sky-500/60 bg-sky-500/[0.16] shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35)]",
          )}
        >
          {h.value || "—"}
        </div>
      </button>
    </li>
  );
}

// =====================================================================
// Right panel toolbar — dashboard parity. Page filter switches from a
// native `<select>` to a shadcn `<DropdownMenu>` for consistency with
// the rest of the app's dropdowns; the trigger reads
// "All fields" / "Page N only" rather than the plugin template's
// "Page N" so the user can see *what* the filter is doing without
// looking at the list. Search button + sort button switch to outline
// shadcn `<Button>`s with sky-tinted active state for the search
// toggle (matches the dashboard treatment). Sort cycle reads from the
// `SORT_LABELS` constant so the tooltip text matches the active mode.
// =====================================================================

function RightPanelToolbar({
  pagesWithFields,
  pageFilter,
  setPageFilter,
  searchOpen,
  setSearchOpen,
  query,
  setQuery,
  sortIdx,
  cycleSortIdx,
}: {
  pagesWithFields: number[];
  pageFilter: number | "all";
  setPageFilter: (p: number | "all") => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  sortIdx: number;
  cycleSortIdx: () => void;
}) {
  const filterTriggerLabel =
    pageFilter === "all" ? "All fields" : `Page ${pageFilter} only`;
  const activeSortLabel = SORT_LABELS[sortIdx % SORT_LABELS.length];
  return (
    <>
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
                <Filter
                  className="size-3.5 shrink-0 opacity-80"
                  aria-hidden
                />
                <span className="truncate">{filterTriggerLabel}</span>
              </span>
              <ChevronDown
                className="size-3.5 shrink-0 opacity-70"
                aria-hidden
              />
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
            {pagesWithFields.map((p) => (
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
              onClick={() => {
                const next = !searchOpen;
                setSearchOpen(next);
                if (!next) setQuery("");
              }}
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
              aria-label={`Sort: ${activeSortLabel}`}
              onClick={cycleSortIdx}
            >
              <ArrowDownUp className="size-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{activeSortLabel}</TooltipContent>
        </Tooltip>
      </div>
      {searchOpen ? (
        <div className="mt-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or value…"
            className="h-8 border-zinc-600/90 bg-zinc-950/80 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:border-zinc-500 focus-visible:ring-sky-500/30"
          />
        </div>
      ) : null}
    </>
  );
}

// =====================================================================
// Right panel — composes header + toolbar + field list
// =====================================================================

function RightPanel({
  highlights,
  totalCount,
  onClose,
  pagesWithFields,
  pageFilter,
  setPageFilter,
  searchOpen,
  setSearchOpen,
  query,
  setQuery,
  sortIdx,
  cycleSortIdx,
  scrollRef,
  linkedHoverFieldId,
  focusedFieldId,
  onLinkedHoverEnter,
  onLinkedHoverLeave,
  onActivate,
  payloadLoading,
  payloadError,
  payloadEmpty,
}: {
  highlights: IdPdfFieldHighlight[];
  totalCount: number;
  onClose: () => void;
  pagesWithFields: number[];
  pageFilter: number | "all";
  setPageFilter: (p: number | "all") => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  sortIdx: number;
  cycleSortIdx: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  linkedHoverFieldId: string | null;
  focusedFieldId: string | null;
  onLinkedHoverEnter: (id: string) => void;
  onLinkedHoverLeave: (id: string) => void;
  onActivate: (id: string) => void;
  payloadLoading: boolean;
  payloadError: string | null;
  payloadEmpty: boolean;
}) {
  // Dashboard parity: surface is `#121212` (the plugin's
  // `bg-zinc-950/40` over a dark workspace produced a near-identical
  // tone, but `#121212` is the literal value the canonical viewer
  // ships and is the durable target). Header sits above the toolbar
  // (filter / search / sort) within a single bordered section, then
  // the scrollable list below uses `gap-6` between rows so the value
  // chips have room to breathe.
  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col border-l border-zinc-800 bg-[#121212] text-zinc-200"
      style={{ width: RIGHT_PANEL_WIDTH_PX }}
      aria-label="All extracted fields"
    >
      <div className="shrink-0 border-b border-zinc-800/90 px-3 pb-2.5 pt-3">
        <div className="flex items-start justify-between gap-2 pr-1">
          <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-white">
            All extracted fields
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
              {totalCount} Field{totalCount === 1 ? "" : "s"}
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
        <RightPanelToolbar
          pagesWithFields={pagesWithFields}
          pageFilter={pageFilter}
          setPageFilter={setPageFilter}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          query={query}
          setQuery={setQuery}
          sortIdx={sortIdx}
          cycleSortIdx={cycleSortIdx}
        />
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4"
      >
        {payloadLoading ? (
          <ul className="flex flex-col gap-6">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <div className="h-3 w-32 animate-pulse rounded bg-white/[0.06]" />
                <div className="mt-2.5 h-10 w-full animate-pulse rounded-md bg-white/[0.04]" />
              </li>
            ))}
          </ul>
        ) : payloadError ? (
          <p className="rounded-md border border-dashed border-rose-700/80 bg-rose-950/40 px-3 py-4 text-center text-xs text-rose-200">
            Could not load extracted fields: {payloadError}
          </p>
        ) : payloadEmpty ? (
          <p className="rounded-md border border-dashed border-zinc-700/80 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-500">
            No extracted-field rows in this run&apos;s IDP output.
          </p>
        ) : highlights.length === 0 ? (
          <p className="text-center text-xs text-zinc-500">
            No fields match the current filter.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {highlights.map((h) => (
              <FieldRow
                key={h.id}
                h={h}
                isLinkedHover={linkedHoverFieldId === h.id}
                isFocused={focusedFieldId === h.id}
                onLinkedHoverEnter={onLinkedHoverEnter}
                onLinkedHoverLeave={onLinkedHoverLeave}
                onActivate={onActivate}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// =====================================================================
// Empty IDP banner — direct copy of plugin reference template.
// =====================================================================

function EmptyIdpBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-white/[0.06] bg-zinc-900/80 px-4 py-2"
    >
      <div className="flex items-start gap-2 text-zinc-300">
        <Info
          className="mt-[1px] size-3.5 shrink-0 text-zinc-400"
          aria-hidden
        />
        <p className="text-[12px] leading-snug">
          <span className="font-medium text-zinc-200">
            No extracted fields for this run.
          </span>{" "}
          <span className="text-zinc-400">
            The document is shown without bounding boxes or a confidence
            panel because this run has no IDP output.
          </span>
        </p>
      </div>
    </div>
  );
}

// =====================================================================
// Top-level viewer
// =====================================================================

export function PdfHighlightViewerV2({ pdfUrl, runId }: Props) {
  // ---- State ----
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);

  const [parsedHighlights, setParsedHighlights] = useState<
    IdPdfFieldHighlight[]
  >([]);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [payloadLoading, setPayloadLoading] = useState(true);

  const [activePage, setActivePage] = useState(1);
  const [linkedHoverFieldId, setLinkedHoverFieldId] = useState<string | null>(
    null,
  );
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [highlightsOn, setHighlightsOn] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [fitMaxCssWidth, setFitMaxCssWidth] = useState(640);

  const [pageFilter, setPageFilter] = useState<number | "all">("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Dashboard parity: sort cycles through three modes by numeric index
  // (page-then-name → name → confidence). The plugin template named
  // these as a discriminated string union; the dashboard's index keeps
  // the active label lookup as a single array index, which lines up
  // with the `SORT_LABELS` constant used by the toolbar tooltip.
  const [sortIdx, setSortIdx] = useState(0);

  const [downloading, setDownloading] = useState(false);

  // ---- Refs ----
  const workspaceRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const lockedFitMaxRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{
    id: string;
    kind: "box" | "row";
  } | null>(null);
  const parsedHighlightsRef = useRef<IdPdfFieldHighlight[]>([]);
  parsedHighlightsRef.current = parsedHighlights;
  const highlightsOnRef = useRef(highlightsOn);
  highlightsOnRef.current = highlightsOn;

  // ---- Fetch PDF (dynamic import per plugin's "Required behavior") ----
  useEffect(() => {
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    void (async () => {
      try {
        // Plugin: dynamic import — `pdfjs-dist` references DOM globals
        // and crashes SSR if imported at module scope.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
        const task = pdfjs.getDocument({ url: pdfUrl, withCredentials: false });
        const doc = await task.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        setPdfDoc(doc);
      } catch (err) {
        if (cancelled) return;
        setPdfError(err instanceof Error ? err.message : "Failed to load PDF.");
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // ---- Fetch IDP payload (AbortController per plugin) ----
  useEffect(() => {
    const ctrl = new AbortController();
    setPayloadLoading(true);
    setPayloadError(null);
    setParsedHighlights([]);
    void (async () => {
      try {
        const res = await fetch(
          `/api/kognitos/runs/${encodeURIComponent(runId)}/payload`,
          { signal: ctrl.signal, cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(`payload HTTP ${res.status}`);
        }
        const json = (await res.json()) as { payload?: unknown };
        const payload =
          json.payload &&
          typeof json.payload === "object" &&
          !Array.isArray(json.payload)
            ? (json.payload as Record<string, unknown>)
            : null;
        const fields = payload ? parseIdpInvoiceFieldHighlights(payload) : [];
        setParsedHighlights(fields);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setPayloadError(
          err instanceof Error ? err.message : "Could not load run payload.",
        );
      } finally {
        setPayloadLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [runId]);

  // ---- Initial page sync — `min(field.pageNumber)` from plugin ----
  useEffect(() => {
    if (parsedHighlights.length === 0) return;
    const first = Math.min(...parsedHighlights.map((h) => h.pageNumber));
    setActivePage(first);
  }, [parsedHighlights]);

  // ---- Document positioning: workspace fit measurement ----
  const applyWorkspaceFit = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const open = panelOpenRef.current;
    const reserve = open ? 0 : RIGHT_PANEL_WIDTH_PX;
    const raw = Math.max(220, Math.floor(el.clientWidth - 80 - reserve));
    if (open) {
      lockedFitMaxRef.current = raw;
      setFitMaxCssWidth(raw);
    } else {
      const cap = lockedFitMaxRef.current;
      setFitMaxCssWidth(cap != null ? Math.min(cap, raw) : raw);
    }
  }, []);

  useEffect(() => {
    if (!pdfDoc) return;
    let ro: ResizeObserver | null = null;
    const id = requestAnimationFrame(() => {
      if (!workspaceRef.current) return;
      applyWorkspaceFit();
      ro = new ResizeObserver(() => applyWorkspaceFit());
      ro.observe(workspaceRef.current);
    });
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
  }, [pdfDoc, applyWorkspaceFit]);

  // Re-fit when the panel toggles so the locked-cap rules apply.
  useEffect(() => {
    applyWorkspaceFit();
  }, [panelOpen, applyWorkspaceFit]);

  // ---- Cross-surface scroll helper ----
  const scrollFieldNodeIntoView = useCallback(
    (id: string, kind: "box" | "row") => {
      const sel =
        kind === "box"
          ? `[data-field-box-id="${CSS.escape(id)}"]`
          : `[data-field-row-id="${CSS.escape(id)}"]`;
      let attempts = 0;
      const maxAttempts = 3;
      const tick = () => {
        const node = document.querySelector<HTMLElement>(sel);
        if (node) {
          node.scrollIntoView({ behavior: "auto", block: "nearest" });
          pendingScrollRef.current = null;
          return;
        }
        if (++attempts < maxAttempts) {
          requestAnimationFrame(tick);
        } else {
          pendingScrollRef.current = { id, kind };
        }
      };
      requestAnimationFrame(tick);
    },
    [],
  );

  // ---- Linked-hover handlers (race-safe) ----
  // Plugin templates wired `onPointerLeave` to `onLinkedHoverChange(null)`,
  // which races when the pointer transits from a bbox to its sibling
  // field row (or vice versa): the leave handler can clear a linked-id
  // that the new entered surface just set. Resolve at the parent with a
  // functional updater that only clears when the leaving id still owns
  // the linked-hover slot. Same pattern the dashboard uses.
  const onLinkedHoverEnter = useCallback((id: string) => {
    setLinkedHoverFieldId(id);
  }, []);
  const onLinkedHoverLeave = useCallback((id: string) => {
    setLinkedHoverFieldId((cur) => (cur === id ? null : cur));
  }, []);

  // ---- Activation handler — re-enable highlights + cross-surface scroll ----
  const onActivateField = useCallback(
    (id: string) => {
      // Plugin: re-enable highlights *before* applying focus side-effects.
      if (!highlightsOnRef.current) setHighlightsOn(true);
      setFocusedFieldId(id);
      const h = parsedHighlightsRef.current.find((x) => x.id === id);
      if (h) setActivePage(h.pageNumber);
      scrollFieldNodeIntoView(id, "box");
      scrollFieldNodeIntoView(id, "row");
    },
    [scrollFieldNodeIntoView],
  );

  // Replay any pending scroll on layout commit (e.g. activePage change).
  useLayoutEffect(() => {
    const p = pendingScrollRef.current;
    if (!p) return;
    pendingScrollRef.current = null;
    scrollFieldNodeIntoView(p.id, p.kind);
  }, [activePage, focusedFieldId, scrollFieldNodeIntoView]);

  // ---- Derived data ----
  const fieldsByPage = useMemo(() => {
    const m: Record<number, IdPdfFieldHighlight[]> = {};
    for (const h of parsedHighlights) {
      (m[h.pageNumber] ??= []).push(h);
    }
    return m;
  }, [parsedHighlights]);

  const pagesWithFields = useMemo(
    () =>
      Object.keys(fieldsByPage)
        .map(Number)
        .sort((a, b) => a - b),
    [fieldsByPage],
  );

  const filteredPanelHighlights = useMemo(() => {
    // Dashboard parity: sort comparator uses the same `localeCompare`
    // (`sensitivity: "base"`) and `fieldConfidencePercent` helpers as
    // the canonical viewer. Search now matches against the raw label
    // and value (humanization belongs to chrome, not row contents,
    // and matching against the humanized form caused a search for
    // `vendor_invoice_number` to find rows where the user typed
    // `Vendor Invoice` but not `vendor_invoice_n`).
    let out =
      pageFilter === "all"
        ? [...parsedHighlights]
        : parsedHighlights.filter((h) => h.pageNumber === pageFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (h) =>
          h.label.toLowerCase().includes(q) ||
          (h.value && h.value.toLowerCase().includes(q)),
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
    } else {
      out.sort(
        (a, b) =>
          a.pageNumber - b.pageNumber ||
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
    }
    return out;
  }, [parsedHighlights, pageFilter, query, sortIdx]);

  const cycleSortIdx = useCallback(() => {
    setSortIdx((i) => (i + 1) % SORT_LABELS.length);
  }, []);

  // Dashboard parity: the bounding-box overlay always reflects the
  // active page's full set of fields, independent of what the panel's
  // page-filter dropdown is set to. The panel filter only affects the
  // right-side list of extracted values; coupling it to the bbox layer
  // hid boxes the user expected to see.
  const highlightsOnActivePage = useMemo(
    () => parsedHighlights.filter((h) => h.pageNumber === activePage),
    [parsedHighlights, activePage],
  );

  const totalPages = pdfDoc?.numPages ?? 0;
  const payloadEmpty =
    !payloadLoading && !payloadError && parsedHighlights.length === 0;

  const displayMaxCssWidth = Math.round(
    Math.min(2800, Math.max(180, fitMaxCssWidth * zoomLevel)),
  );

  // ---- Download ----
  const onDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const a = document.createElement("a");
      a.href = pdfUrl;
      a.download = `invoice-${runId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
    }
  }, [pdfUrl, runId]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 bg-zinc-900 text-zinc-100">
        {/* Page rail. Dashboard parity: render whenever a PDF is loaded,
            including single-page documents. The single-page PageRail
            still renders one thumbnail; this keeps the column structure
            (rail | workspace | panel) stable across runs. */}
        {pdfDoc ? (
          <PageRail
            pdf={pdfDoc}
            pages={totalPages}
            activePage={activePage}
            setActivePage={setActivePage}
            fieldsByPage={fieldsByPage}
          />
        ) : null}

        {/* Document workspace.

            The center column is a flex column with three children:
            (1) the optional empty-IDP banner, (2) the scrollable
            workspace that hosts the canvas + overlays, (3) the bottom
            toolbar strip. Keeping the toolbar as a sibling of the
            scrolling div — not a descendant — is what pins it at the
            bottom of the viewport. Putting the toolbar inside the
            scroll container made it move with the content during
            scroll. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {payloadEmpty ? <EmptyIdpBanner /> : null}
          <div
            ref={workspaceRef}
            className="relative min-h-0 min-w-0 flex-1 overflow-auto overflow-x-auto bg-[#323234]"
          >
            {/* Dashboard parity: the workspace itself sets no padding;
                an inner flex container centers the page and applies
                `px-10 pb-10 pt-10`. The plugin template's `p-6` on the
                scroll surface left the page hugging the rail edge on
                wide layouts and let the bottom of the document drop
                under the toolbar. */}
            <div className="relative z-0 flex min-h-full w-full min-w-0 items-center justify-center px-10 pb-10 pt-10">
              {pdfLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-300">
                  Loading PDF…
                </div>
              ) : pdfError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rose-300">
                  Could not load the document: {pdfError}
                </div>
              ) : pdfDoc ? (
                /* `key={activePage}` so layout/render refs reset cleanly
                   when the page changes (plugin: Reset Across Runs). */
                <PdfPageWithHighlights
                  key={activePage}
                  pdf={pdfDoc}
                  pageNumber1={activePage}
                  maxCssWidth={displayMaxCssWidth}
                  highlights={highlightsOnActivePage}
                  highlightsOn={highlightsOn}
                  linkedHoverFieldId={linkedHoverFieldId}
                  focusedFieldId={focusedFieldId}
                  onLinkedHoverEnter={onLinkedHoverEnter}
                  onLinkedHoverLeave={onLinkedHoverLeave}
                  onActivate={onActivateField}
                />
              ) : null}
            </div>
          </div>
          <div className="pointer-events-none z-40 flex shrink-0 justify-center border-t border-white/[0.06] bg-[#323234] py-[0.6375rem]">
            <BottomToolbar
              zoomLevel={zoomLevel}
              setZoomLevel={setZoomLevel}
              resetZoom={() => setZoomLevel(1)}
              highlightsOn={highlightsOn}
              setHighlightsOn={setHighlightsOn}
              panelOpen={panelOpen}
              setPanelOpen={setPanelOpen}
              onDownload={onDownload}
              downloading={downloading}
            />
          </div>
        </div>

        {/* Right panel. */}
        {panelOpen ? (
          <RightPanel
            highlights={filteredPanelHighlights}
            totalCount={parsedHighlights.length}
            onClose={() => setPanelOpen(false)}
            pagesWithFields={pagesWithFields}
            pageFilter={pageFilter}
            setPageFilter={setPageFilter}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            query={query}
            setQuery={setQuery}
            sortIdx={sortIdx}
            cycleSortIdx={cycleSortIdx}
            scrollRef={panelScrollRef}
            linkedHoverFieldId={linkedHoverFieldId}
            focusedFieldId={focusedFieldId}
            onLinkedHoverEnter={onLinkedHoverEnter}
            onLinkedHoverLeave={onLinkedHoverLeave}
            onActivate={onActivateField}
            payloadLoading={payloadLoading}
            payloadError={payloadError}
            payloadEmpty={payloadEmpty}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
