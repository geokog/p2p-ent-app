"use client";

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
  Download,
  Layers2,
  Maximize2,
  PanelLeft,
  PanelLeftClose,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { Button } from "@/components/ui/button";
import {
  formatHighlightTooltip,
  parseIdpInvoiceFieldHighlights,
  type IdPdfFieldHighlight,
} from "@/lib/kognitos/idp-invoice-field-highlights";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
}: {
  h: IdPdfFieldHighlight;
  baseW: number;
  baseH: number;
}) {
  const tip = formatHighlightTooltip(h);
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
  const portalLayerClass =
    "z-[100] max-w-sm whitespace-pre-wrap text-left text-xs font-mono leading-snug";
  return (
    <Popover modal={false}>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "absolute z-[21] box-border cursor-pointer border border-solid bg-transparent opacity-100 outline-none",
                "rounded-[2px] border-[rgba(255,255,255,0.85)] transition-[border-color]",
                "shadow-none [box-shadow:none]",
                "pointer-events-auto",
                "hover:border-[rgba(255,255,255,1)] hover:bg-transparent",
                "focus-visible:border-[rgba(255,255,255,1)] focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
              style={boxStyle}
              aria-label={tip}
            />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className={portalLayerClass}>
          {tip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="center" className={portalLayerClass}>
        {tip}
      </PopoverContent>
    </Popover>
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
}: {
  pdf: PDFDocumentProxy;
  pageNumber1: number;
  maxCssWidth: number;
  pageHighlights: IdPdfFieldHighlight[];
  overlayEnabled: boolean;
  surface?: "card" | "workspace";
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
        "relative overflow-hidden bg-white",
        surface === "workspace"
          ? ""
          : "mx-auto mb-6 rounded border border-border shadow-sm",
      )}
      style={{
        width: layout?.cssW ?? Math.max(120, maxCssWidth),
        minHeight: layout?.cssH ?? 200,
      }}
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
          "relative z-0 block max-h-none w-auto",
          surface === "workspace" ? "max-w-none" : "max-w-full",
        )}
        style={{ verticalAlign: "top" }}
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
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
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

export function InvoicePdfHighlightViewer({ pdfUrl, runId }: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [showFieldOverlays, setShowFieldOverlays] = useState(true);
  const [fitMaxCssWidth, setFitMaxCssWidth] = useState(640);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [thumbRailExpanded, setThumbRailExpanded] = useState(true);
  const [parsedHighlights, setParsedHighlights] = useState<IdPdfFieldHighlight[]>([]);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);

  const displayMaxCssWidth = Math.round(
    Math.min(2800, Math.max(180, fitMaxCssWidth * zoomLevel)),
  );

  useEffect(() => {
    if (!pdfDoc) return;
    let ro: ResizeObserver | null = null;
    const id = requestAnimationFrame(() => {
      const el = workspaceRef.current;
      if (!el) return;
      const measure = () => {
        setFitMaxCssWidth(Math.max(220, Math.floor(el.clientWidth - 80)));
      };
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(el);
    });
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
  }, [pdfDoc]);

  useEffect(() => {
    setActivePage(1);
    setZoomLevel(1);
  }, [pdfUrl]);

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

  const toolbarBtnClass =
    "size-9 text-zinc-700 hover:bg-zinc-200/90 hover:text-zinc-950";

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
          <div className="flex min-h-0 flex-1 flex-row">
            <aside
              className={cn(
                "flex shrink-0 flex-col border-r border-white/[0.06] bg-[#1c1c1e] text-zinc-200 transition-[width] duration-200 ease-out",
                thumbRailExpanded ? "w-[76px]" : "w-10 overflow-hidden",
              )}
              aria-label="Page thumbnails"
            >
              <div className="flex w-full shrink-0 justify-center border-b border-white/[0.06] px-1 py-2">
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-9 shrink-0 rounded-md border border-white/15 bg-white/[0.07] text-zinc-100 shadow-sm hover:border-white/25 hover:bg-white/15 hover:text-white"
                      onClick={() => setThumbRailExpanded((v) => !v)}
                      aria-expanded={thumbRailExpanded}
                      aria-label={
                        thumbRailExpanded
                          ? "Collapse page thumbnails"
                          : "Expand page thumbnails"
                      }
                    >
                      {thumbRailExpanded ? (
                        <PanelLeftClose className="size-5" strokeWidth={2} aria-hidden />
                      ) : (
                        <PanelLeft className="size-5" strokeWidth={2} aria-hidden />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {thumbRailExpanded ? "Collapse thumbnails" : "Show thumbnails"}
                  </TooltipContent>
                </Tooltip>
              </div>
              {thumbRailExpanded ? (
                <div className="flex flex-1 flex-col items-center overflow-y-auto py-2 pl-1.5 pr-1">
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
              ) : null}
            </aside>
            <div
              ref={workspaceRef}
              className="relative min-h-0 flex-1 overflow-auto bg-[#323234]"
            >
              <div className="relative z-0 flex min-h-full justify-center px-10 pb-28 pt-10">
                <PdfPageWithHighlights
                  key={activePage}
                  pdf={pdfDoc}
                  pageNumber1={activePage}
                  maxCssWidth={displayMaxCssWidth}
                  pageHighlights={byPage(activePage)}
                  overlayEnabled={showFieldOverlays}
                  surface="workspace"
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
                <div
                  className={cn(
                    "pointer-events-auto flex items-center gap-0.5 rounded-full border px-1.5 py-1",
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
                        <ZoomOut className="size-4" />
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
                        <ZoomIn className="size-4" />
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
                        <Maximize2 className="size-4" />
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
                        <Layers2 className="size-4" />
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
                        <Download className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Download PDF</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
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
