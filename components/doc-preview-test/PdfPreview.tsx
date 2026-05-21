"use client";

/**
 * Document-preview test bed.
 *
 * Self-contained PDF preview dialog that renders a Kognitos run's IDP
 * extraction output: PDF canvas with bounding-box overlay, page rail,
 * right panel of extracted fields with confidence bars, and a floating
 * toolbar. Built from scratch against the document-preview skill — no
 * code shared with the in-app `InvoicePdfHighlightViewer`.
 *
 * Public surface is `<PdfPreviewDialog open runId onOpenChange />`. The
 * dialog mounts `<PdfPreviewContent key={runId} />` so all state and refs
 * reset cleanly when the operator switches between runs.
 *
 * Wiring:
 *   - PDF bytes  : `/api/kognitos/runs/{runId}/invoice-pdf` (resolves the
 *     run's input file id and downloads via the Files API; the underlying
 *     adapter handles workspace fallback on 404).
 *   - IDP payload: `/api/kognitos/runs/{runId}/payload`.
 *
 * Both fetches run in parallel under their own `AbortController`s, both
 * are aborted on dialog close and `runId` change.
 */

import {
  ArrowDownAZ,
  BarChart3,
  Download,
  Eye,
  EyeOff,
  FileText,
  Hash,
  Info,
  ListFilter,
  Maximize,
  PanelRight,
  PanelLeftClose,
  Search,
  Type as TypeIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as React from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatIdpValue,
  humanizeFieldName,
} from "@/lib/doc-preview-test/format-value";
import {
  chooseYAxisFlipForPage,
  parseFieldHighlights,
  type FieldHighlight,
} from "@/lib/doc-preview-test/idp-parser";

// PDF.js types are import-only — runtime is loaded via dynamic import inside
// effects so server bundles never reach for `window`.
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reserved width for the right panel. Subtract this from the workspace
 * measurement even when the panel is collapsed so the document never
 * reflows when the operator opens it for the first time.
 */
const RIGHT_PANEL_WIDTH = 320;
const PAGE_RAIL_WIDTH = 120;
const TOOLBAR_BUTTON_SIZE = 30;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.12;
const ACTIVE_PAGE_DPR_CAP = 3;
const THUMBNAIL_DPR_CAP = 2;
const THUMBNAIL_CSS_WIDTH = 96;

/* -------------------------------------------------------------------------- */
/* Public dialog                                                              */
/* -------------------------------------------------------------------------- */

export type PdfPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
  /**
   * Optional title for the dialog; falls back to "Document Processing" when
   * the document filename is not known yet (parity with other entry points).
   */
  title?: string | null;
};

/**
 * Top-level dialog wrapper. The actual viewer is mounted inside a
 * `<PdfPreviewContent key={runId}>` so refs and state reset across runs.
 */
export function PdfPreviewDialog({
  open,
  onOpenChange,
  runId,
  title,
}: PdfPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        centerFlex
        showCloseButton
        className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-950 p-0 text-zinc-100 shadow-xl shadow-black/30"
      >
        {/* Single TooltipProvider for every tooltip in the dialog tree.
            Without this, each tooltip remounts its own provider and the
            toolbar feels laggy. */}
        <TooltipProvider delayDuration={250}>
          <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-950 px-4 py-2 text-left">
            <DialogTitle className="text-base font-medium text-zinc-50">
              {title ?? "Document Processing"}
            </DialogTitle>
            {/* Visually hidden — silences the Radix accessibility warning
                that an aria-describedby is missing for screen-reader users. */}
            <DialogDescription className="sr-only">
              Document preview with extracted IDP fields, bounding-box
              overlay, page rail, and right-panel field list.
            </DialogDescription>
          </DialogHeader>
          {open && runId ? (
            <PdfPreviewContent key={runId} runId={runId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              Provide a runId to load a document.
            </div>
          )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout helper                                                              */
/* -------------------------------------------------------------------------- */

type PageBase = { baseW: number; baseH: number };
type PageLayout = PageBase & { cssW: number; cssH: number };

/**
 * Single source of truth for the active page's CSS pixel size. Canvas,
 * mask, and overlay layers all consume the same `layout` object so they
 * stay pixel-aligned across zoom + resize.
 */
function layoutForZoom(
  base: PageBase | null,
  maxCssWidth: number,
  zoom: number,
): PageLayout | null {
  if (!base || maxCssWidth <= 0) return null;
  const naturalCssW = Math.max(120, Math.min(maxCssWidth, base.baseW * zoom));
  const scale = naturalCssW / base.baseW;
  const cssH = base.baseH * scale;
  return { ...base, cssW: naturalCssW, cssH };
}

/* -------------------------------------------------------------------------- */
/* Workspace + content                                                        */
/* -------------------------------------------------------------------------- */

type ViewerStatus =
  | "pdf-loading"
  | "pdf-error"
  | "payload-loading"
  | "payload-empty"
  | "payload-error"
  | "ready"
  | "rendering-page";

function PdfPreviewContent({ runId }: { runId: string }) {
  const pdfUrl = `/api/kognitos/runs/${encodeURIComponent(runId)}/invoice-pdf`;

  // ----- PDF document -----
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // ----- IDP payload -----
  const [parsedHighlights, setParsedHighlights] = useState<FieldHighlight[]>([]);
  const [payloadLoading, setPayloadLoading] = useState(true);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // ----- Page state -----
  const [activePage, setActivePage] = useState(1);
  const [activePageRendering, setActivePageRendering] = useState(false);

  // ----- UI state -----
  const [zoom, setZoom] = useState(1);
  const [highlightsOn, setHighlightsOn] = useState(true);
  const highlightsOnRef = useRef(highlightsOn);
  highlightsOnRef.current = highlightsOn;

  const [panelOpen, setPanelOpen] = useState(true);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [linkedHoverFieldId, setLinkedHoverFieldId] = useState<string | null>(null);

  // Stable refs for the activation handler so callbacks don't re-create
  // every render.
  const parsedHighlightsRef = useRef<FieldHighlight[]>([]);
  parsedHighlightsRef.current = parsedHighlights;

  // ----- PDF fetch -----
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setPdfLoading(true);
    setPdfError(null);
    setPdf(null);

    void (async () => {
      try {
        // Dynamic import so server bundles never see `window`.
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        // Same-origin worker pinned to the installed `pdfjs-dist` version
        // (copied to public/ during postinstall + prebuild).
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

        // Fetch via fetch() so we can wire the same AbortController to the
        // network request and surface a real error message — `getDocument`
        // accepts a `data: ArrayBuffer` for already-fetched bytes.
        const res = await fetch(pdfUrl, { signal: ctrl.signal });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "We couldn't find a PDF for this run (404)."
              : `Failed to load PDF (HTTP ${res.status}).`,
          );
        }
        const cd = res.headers.get("Content-Disposition") ?? "";
        const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?\"?([^\";]+)\"?/i);
        if (fnMatch?.[1]) {
          try {
            setPdfFilename(decodeURIComponent(fnMatch[1].trim()));
          } catch {
            setPdfFilename(fnMatch[1].trim());
          }
        }
        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        const task = pdfjs.getDocument({
          data: bytes,
          withCredentials: false,
        });
        const doc = await task.promise;
        if (cancelled) {
          void doc.destroy().catch(() => {});
          return;
        }
        setPdf(doc);
        setPdfLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        if (e.name === "AbortError") return;
        setPdfError(e.message || "Could not load PDF.");
        setPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [pdfUrl, retryNonce]);

  // PDF teardown when the document object changes or the component unmounts.
  useEffect(() => {
    if (!pdf) return;
    return () => {
      void pdf.destroy().catch(() => {});
    };
  }, [pdf]);

  // ----- Payload fetch -----
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setPayloadLoading(true);
    setPayloadError(null);
    setParsedHighlights([]);

    void (async () => {
      try {
        const res = await fetch(
          `/api/kognitos/runs/${encodeURIComponent(runId)}/payload`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          // 404 just means "no stored payload yet" — present as empty, not as
          // an error banner.
          if (res.status === 404) {
            if (cancelled) return;
            setParsedHighlights([]);
            setPayloadLoading(false);
            return;
          }
          throw new Error(`Could not load run payload (HTTP ${res.status}).`);
        }
        const json = (await res.json()) as { payload?: unknown };
        if (cancelled) return;
        const { highlights } = parseFieldHighlights(json.payload ?? null);
        setParsedHighlights(highlights);
        setPayloadLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        if (e.name === "AbortError") return;
        setPayloadError(e.message || "Could not load extracted fields.");
        setPayloadLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [runId]);

  // ----- Initial page sync -----
  // After fields load, jump to the first page that has highlights instead of
  // an unconditional `setActivePage(1)`. Otherwise an effect ordering bug can
  // leave every box on a page the operator never navigates to.
  useEffect(() => {
    if (parsedHighlights.length === 0) return;
    const minPage = parsedHighlights.reduce(
      (m, h) => (h.pageNumber < m ? h.pageNumber : m),
      parsedHighlights[0].pageNumber,
    );
    setActivePage(minPage);
  }, [parsedHighlights]);

  // ----- Highlights grouped by page -----
  const fieldsByPage = useMemo(() => {
    const m = new Map<number, FieldHighlight[]>();
    for (const h of parsedHighlights) {
      const list = m.get(h.pageNumber);
      if (list) list.push(h);
      else m.set(h.pageNumber, [h]);
    }
    return m;
  }, [parsedHighlights]);

  const highlightsOnActivePage = useMemo(
    () => fieldsByPage.get(activePage) ?? [],
    [fieldsByPage, activePage],
  );

  // ----- Workspace size / fit cap -----
  // Reserve the right-panel width even when the panel is collapsed so the
  // document does not reflow on first open. Lock the cap measured while the
  // panel was open, and use `min(cap, currentRaw)` afterwards.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const fitCapRef = useRef<number | null>(null);
  const [maxCssWidth, setMaxCssWidth] = useState(720);

  useLayoutEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const totalPages = pdf?.numPages ?? 0;
    const rail = totalPages > 1 ? PAGE_RAIL_WIDTH : 0;
    const reservedRight = RIGHT_PANEL_WIDTH; // reserved either way

    const measure = () => {
      const w = node.clientWidth;
      const raw = Math.max(160, w - rail - reservedRight - 32 /* horizontal padding */);
      // Cap is set the first time we measure with the panel "open" (or
      // simply with the reserved width subtracted, since reservation is
      // permanent). Locking it prevents the document from enlarging when
      // the panel is later collapsed.
      if (fitCapRef.current == null) fitCapRef.current = raw;
      const cap = fitCapRef.current;
      setMaxCssWidth(Math.min(cap, raw));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [pdf?.numPages, panelOpen]);

  // ----- Cross-surface scrolling -----
  // Helpers + helpers + helpers — all consume the `data-field-*-id`
  // attributes (the "hit-target" contract). Re-attempt across multiple
  // requestAnimationFrame ticks so a layout commit gap after `activePage`
  // change doesn't drop the scroll on the floor.
  const pendingScrollRef = useRef<{
    id: string;
    kind: "box" | "row";
  } | null>(null);

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
          if (
            pendingScrollRef.current?.id === id &&
            pendingScrollRef.current?.kind === kind
          ) {
            pendingScrollRef.current = null;
          }
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

  // Replay any pending scroll on layout commit (e.g. after activePage change).
  useLayoutEffect(() => {
    const p = pendingScrollRef.current;
    if (!p) return;
    pendingScrollRef.current = null;
    scrollFieldNodeIntoView(p.id, p.kind);
  }, [activePage, focusedFieldId, scrollFieldNodeIntoView]);

  // ----- Activation handler -----
  // Single source of truth for "user activated field X on either surface".
  // Runs the off→on highlight re-enable BEFORE focus side-effects so the
  // operator sees the box light up immediately.
  const onActivateField = useCallback(
    (id: string) => {
      if (!highlightsOnRef.current) setHighlightsOn(true);
      const h = parsedHighlightsRef.current.find((x) => x.id === id);
      if (h && h.pageNumber !== activePage) setActivePage(h.pageNumber);
      setFocusedFieldId(id);
      scrollFieldNodeIntoView(id, "box");
      scrollFieldNodeIntoView(id, "row");
    },
    [activePage, scrollFieldNodeIntoView],
  );

  // Cancel any pending scroll on runId change / dialog close (the parent
  // re-mounts via key={runId}, so this is belt-and-suspenders).
  useEffect(() => {
    return () => {
      pendingScrollRef.current = null;
    };
  }, []);

  // ----- Status (derived state) -----
  // Surfaces every state from the skill's State Coverage table on a
  // `data-viewer-status` attribute on the workspace so QA can assert which
  // state is rendered at any point. Each state has an explicit UI
  // transition wired in the markup below or in child components (see the
  // big comment block below).
  const status: ViewerStatus = useMemo(() => {
    if (pdfLoading && pdf == null && pdfError == null) return "pdf-loading";
    if (pdfError) return "pdf-error";
    if (payloadError) return "payload-error";
    if (payloadLoading) return "payload-loading";
    if (parsedHighlights.length === 0) return "payload-empty";
    if (activePageRendering) return "rendering-page";
    return "ready";
  }, [
    pdfError,
    pdfLoading,
    pdf,
    payloadError,
    payloadLoading,
    parsedHighlights.length,
    activePageRendering,
  ]);

  // State Coverage map (matches the skill's table):
  //   idle           → the first effect tick before fetches kick off
  //                    (lasts < 1 frame; collapsed into `pdf-loading`).
  //   pdf-loading    → workspace spinner ("Loading PDF…").
  //   pdf-error      → <PdfErrorBanner /> with Retry.
  //   payload-loading→ <PanelSkeleton /> in the right panel.
  //   payload-error  → in-panel error banner; document still renders.
  //   payload-empty  → <PayloadEmptyBanner /> below the document.
  //   ready          → default steady state.
  //   rendering-page → "Rendering page N…" overlay inside the page comp.
  //   render-cancelled → swallowed by the render-task cleanup paths.
  //   highlights-off → toolbar pressed-state + dim/box layers hidden.
  //   panel-collapsed→ panel returns null; workspace claims locked-cap width.
  //   closing        → AbortControllers fire on unmount; pendingScrollRef
  //                    is cleared; PDF is destroyed in a teardown effect.

  const totalPages = pdf?.numPages ?? 0;
  const showRail = totalPages > 1;

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-zinc-900"
      data-viewer-status={status}
      data-highlights-on={highlightsOn ? "true" : "false"}
      data-panel-open={panelOpen ? "true" : "false"}
    >
      {/* Page rail */}
      {showRail ? (
        <PageRail
          pdf={pdf}
          pages={totalPages}
          activePage={activePage}
          setActivePage={setActivePage}
          fieldsByPage={fieldsByPage}
        />
      ) : null}

      {/* Document workspace */}
      <div
        ref={workspaceRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-900"
      >
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto px-4 py-4">
          {pdfLoading ? (
            <div className="mt-10 flex flex-col items-center gap-2 text-sm text-zinc-400">
              <span
                className="size-5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200"
                aria-hidden
              />
              Loading PDF…
            </div>
          ) : pdfError ? (
            <PdfErrorBanner
              message={pdfError}
              onRetry={() => {
                fitCapRef.current = null;
                setRetryNonce((n) => n + 1);
              }}
            />
          ) : pdf ? (
            <div className="flex flex-col items-center">
              <PdfPageWithHighlights
                key={activePage}
                pdf={pdf}
                pageNumber1={activePage}
                maxCssWidth={maxCssWidth}
                zoom={zoom}
                highlights={highlightsOnActivePage}
                highlightsOn={highlightsOn}
                focusedFieldId={focusedFieldId}
                linkedHoverFieldId={linkedHoverFieldId}
                onActivate={onActivateField}
                onHoverField={setLinkedHoverFieldId}
                onRenderingChange={setActivePageRendering}
              />
            </div>
          ) : null}
        </div>

        {/* Empty IDP banner — distinct from `payload-error`. */}
        {!pdfLoading && !pdfError && status === "payload-empty" ? (
          <PayloadEmptyBanner />
        ) : null}

        {/* Floating bottom toolbar */}
        {pdf && !pdfError ? (
          <BottomToolbar
            zoom={zoom}
            setZoom={setZoom}
            onFitWidth={() => setZoom(1)}
            highlightsOn={highlightsOn}
            setHighlightsOn={setHighlightsOn}
            panelOpen={panelOpen}
            setPanelOpen={setPanelOpen}
            downloadHref={`${pdfUrl}?download=1`}
            downloadFilename={pdfFilename ?? "document.pdf"}
          />
        ) : null}
      </div>

      {/* Right panel */}
      <RightPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        loading={payloadLoading}
        error={payloadError}
        highlights={parsedHighlights}
        activePage={activePage}
        setActivePage={setActivePage}
        focusedFieldId={focusedFieldId}
        linkedHoverFieldId={linkedHoverFieldId}
        onActivate={onActivateField}
        onHoverField={setLinkedHoverFieldId}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Banners                                                                    */
/* -------------------------------------------------------------------------- */

function PdfErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-12 max-w-md rounded-lg border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-100"
    >
      <div className="mb-2 font-medium">Could not load PDF</div>
      <p className="mb-3 text-rose-200/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-rose-700/60 bg-rose-900/40 px-3 py-1 text-sm text-rose-50 hover:bg-rose-900/70"
      >
        Retry
      </button>
    </div>
  );
}

function PayloadEmptyBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-t border-white/[0.06] bg-zinc-900/80 px-4 py-2"
    >
      <div className="flex items-start gap-2 text-zinc-300">
        <Info className="mt-[1px] size-3.5 shrink-0 text-zinc-400" aria-hidden />
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

/* -------------------------------------------------------------------------- */
/* Page rail                                                                  */
/* -------------------------------------------------------------------------- */

function PageRail({
  pdf,
  pages,
  activePage,
  setActivePage,
  fieldsByPage,
}: {
  pdf: PDFDocumentProxy | null;
  pages: number;
  activePage: number;
  setActivePage: (n: number) => void;
  fieldsByPage: Map<number, FieldHighlight[]>;
}) {
  return (
    <nav
      aria-label="Document pages"
      className="flex h-full shrink-0 flex-col gap-2 overflow-y-auto border-r border-white/[0.06] bg-zinc-950/40 p-2"
      style={{ width: PAGE_RAIL_WIDTH }}
    >
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
        const count = fieldsByPage.get(p)?.length ?? 0;
        const active = p === activePage;
        return (
          <button
            key={p}
            type="button"
            onClick={() => setActivePage(p)}
            aria-current={active ? "page" : undefined}
            aria-label={`Page ${p} of ${pages}${count ? `, ${count} fields` : ""}`}
            className={cn(
              "group relative flex flex-col items-center gap-1 rounded-md p-1.5",
              active
                ? "bg-white/[0.06] ring-2 ring-sky-400"
                : "ring-1 ring-white/[0.05] hover:ring-white/[0.15]",
            )}
          >
            <PageThumbnail
              pdf={pdf}
              pageNumber={p}
              maxCssWidth={THUMBNAIL_CSS_WIDTH}
            />
            <span className="font-mono text-[10px] text-zinc-400">{p}</span>
            {count > 0 ? (
              <span className="absolute right-1 top-1 rounded bg-sky-500/80 px-1 text-[10px] font-medium text-zinc-950">
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function PageThumbnail({
  pdf,
  pageNumber,
  maxCssWidth,
}: {
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  maxCssWidth: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver in this environment — render immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- env-fallback only
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!visible || !pdf) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      const prev = renderTaskRef.current;
      if (prev) {
        prev.cancel();
        try {
          await prev.promise;
        } catch {
          /* RenderingCancelledException — expected */
        }
        renderTaskRef.current = null;
      }
      if (cancelled) return;
      let page: PDFPageProxy;
      try {
        page = await pdf.getPage(pageNumber);
      } catch {
        return;
      }
      if (cancelled) return;
      const baseVp = page.getViewport({ scale: 1 });
      const cssScale = maxCssWidth / baseVp.width;
      const cssH = baseVp.height * cssScale;
      const dpr =
        typeof window !== "undefined"
          ? Math.min(Math.max(window.devicePixelRatio || 1, 1), THUMBNAIL_DPR_CAP)
          : 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.max(1, Math.floor(maxCssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${maxCssWidth}px`;
      canvas.style.height = `${cssH}px`;
      const vp = page.getViewport({ scale: cssScale });
      const transform: [number, number, number, number, number, number] | undefined =
        dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform,
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    })();
    return () => {
      cancelled = true;
      const t = renderTaskRef.current;
      if (t) {
        t.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, maxCssWidth, visible]);

  return (
    <div
      ref={wrapperRef}
      className="rounded-sm bg-zinc-800"
      style={{ width: maxCssWidth, minHeight: 100 }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PDF page + bounding-box overlay                                            */
/* -------------------------------------------------------------------------- */

function PdfPageWithHighlights({
  pdf,
  pageNumber1,
  maxCssWidth,
  zoom,
  highlights,
  highlightsOn,
  focusedFieldId,
  linkedHoverFieldId,
  onActivate,
  onHoverField,
  onRenderingChange,
}: {
  pdf: PDFDocumentProxy;
  pageNumber1: number;
  maxCssWidth: number;
  zoom: number;
  highlights: FieldHighlight[];
  highlightsOn: boolean;
  focusedFieldId: string | null;
  linkedHoverFieldId: string | null;
  onActivate: (id: string) => void;
  onHoverField: (id: string | null) => void;
  onRenderingChange: (rendering: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [pageBase, setPageBase] = useState<PageBase | null>(null);

  // Read base viewport once per page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber1);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setPageBase({ baseW: vp.width, baseH: vp.height });
      } catch {
        // ignore — page lookup failures surface as "no layout" → "Rendering…" state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber1]);

  const layout = useMemo(
    () => layoutForZoom(pageBase, maxCssWidth, zoom),
    [pageBase, maxCssWidth, zoom],
  );

  // DPR-aware render of the active page. Cancellable; cleans up render task
  // refs to avoid the "Cannot use the same canvas during multiple render()"
  // exception on rapid prop changes.
  useLayoutEffect(() => {
    if (!layout) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onRenderingChange(true);

    void (async () => {
      const prev = renderTaskRef.current;
      if (prev) {
        prev.cancel();
        try {
          await prev.promise;
        } catch {
          /* RenderingCancelledException — expected */
        }
        renderTaskRef.current = null;
      }
      if (cancelled) return;
      let page: PDFPageProxy;
      try {
        page = await pdf.getPage(pageNumber1);
      } catch {
        if (!cancelled) onRenderingChange(false);
        return;
      }
      if (cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        if (!cancelled) onRenderingChange(false);
        return;
      }
      const cssScale = layout.cssW / layout.baseW;
      const vp = page.getViewport({ scale: cssScale });
      const dpr =
        typeof window !== "undefined"
          ? Math.min(Math.max(window.devicePixelRatio || 1, 1), ACTIVE_PAGE_DPR_CAP)
          : 1;
      canvas.width = Math.max(1, Math.floor(layout.cssW * dpr));
      canvas.height = Math.max(1, Math.floor(layout.cssH * dpr));
      canvas.style.width = `${layout.cssW}px`;
      canvas.style.height = `${layout.cssH}px`;
      const transform: [number, number, number, number, number, number] | undefined =
        dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform,
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
      if (renderTaskRef.current === task) {
        renderTaskRef.current = null;
        if (!cancelled) onRenderingChange(false);
      }
    })();

    return () => {
      cancelled = true;
      const t = renderTaskRef.current;
      if (t) {
        t.cancel();
        renderTaskRef.current = null;
      }
      onRenderingChange(false);
    };
  }, [pdf, pageNumber1, layout, onRenderingChange]);

  // Container reserves space even when layout is not yet committed.
  return (
    <div
      className="relative"
      style={
        layout
          ? { width: layout.cssW, height: layout.cssH, isolation: "isolate" }
          : { width: Math.max(maxCssWidth, 240), minHeight: 240, isolation: "isolate" }
      }
    >
      {!layout ? (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/60 text-xs text-zinc-400">
          Rendering page {pageNumber1}…
        </div>
      ) : null}
      <canvas ref={canvasRef} className="block bg-white" />
      {layout && highlightsOn ? (
        <PdfPageOverlay
          layout={layout}
          highlights={highlights}
          focusedFieldId={focusedFieldId}
          linkedHoverFieldId={linkedHoverFieldId}
          onActivate={onActivate}
          onHoverField={onHoverField}
        />
      ) : null}
    </div>
  );
}

/**
 * Per-field bbox in CSS pixels, relative to `layout`. Both modes resolve to
 * the same percentage layout (we apply the page-level Y-axis flip before
 * scaling). Enforces a minimum width/height so degenerate normalized boxes
 * don't collapse to a zero-area button.
 */
function bboxToCssRect(
  field: FieldHighlight,
  layout: PageLayout,
  flip: "flip" | "noflip",
): { x: number; y: number; w: number; h: number } {
  const { x, y, width, height } = field.bbox;
  if (field.bboxCoordMode === "normalized") {
    return clampRect({
      x: x * layout.cssW,
      y: y * layout.cssH,
      w: Math.max(width * layout.cssW, 12),
      h: Math.max(height * layout.cssH, 12),
    }, layout);
  }
  // pdf_points — convert to CSS via base viewport scale, applying flip if needed.
  const sx = layout.cssW / layout.baseW;
  const sy = layout.cssH / layout.baseH;
  const yPoints = flip === "flip" ? layout.baseH - y - height : y;
  return clampRect(
    {
      x: x * sx,
      y: yPoints * sy,
      w: Math.max(width * sx, 12),
      h: Math.max(height * sy, 12),
    },
    layout,
  );
}

function clampRect(
  r: { x: number; y: number; w: number; h: number },
  layout: PageLayout,
) {
  const x = Math.max(0, Math.min(layout.cssW - 1, r.x));
  const y = Math.max(0, Math.min(layout.cssH - 1, r.y));
  const w = Math.max(8, Math.min(layout.cssW - x, r.w));
  const h = Math.max(8, Math.min(layout.cssH - y, r.h));
  return { x, y, w, h };
}

function PdfPageOverlay({
  layout,
  highlights,
  focusedFieldId,
  linkedHoverFieldId,
  onActivate,
  onHoverField,
}: {
  layout: PageLayout;
  highlights: FieldHighlight[];
  focusedFieldId: string | null;
  linkedHoverFieldId: string | null;
  onActivate: (id: string) => void;
  onHoverField: (id: string | null) => void;
}) {
  const rawId = useId();
  // SVG ids may not contain `:` and must survive hydration / multi-dialog mount.
  const maskId = `dpt-dim-${rawId.replace(/:/g, "")}`;

  // Per-page Y-axis flip decision for non-normalized bboxes — IDP can mix
  // conventions across pages.
  const yFlip = useMemo(() => {
    const nonNormalized = highlights.filter(
      (h) => h.bboxCoordMode === "pdf_points",
    );
    if (nonNormalized.length === 0) return "noflip" as const;
    return chooseYAxisFlipForPage(
      nonNormalized.map((h) => ({ bbox: h.bbox })),
      { width: layout.baseW, height: layout.baseH },
    );
  }, [highlights, layout.baseW, layout.baseH]);

  const rects = useMemo(
    () =>
      highlights.map((h) => ({
        h,
        rect: bboxToCssRect(h, layout, yFlip),
      })),
    [highlights, layout, yFlip],
  );

  return (
    <>
      {/* SVG mask (ids are scoped via useId). */}
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
            <rect width={layout.cssW} height={layout.cssH} fill="white" />
            {rects.map(({ h, rect }) => (
              <rect
                key={h.id}
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                fill="black"
                shapeRendering="crispEdges"
              />
            ))}
          </mask>
        </defs>
      </svg>

      {/* Dim layer (luminance mask cuts holes for each bbox). */}
      <div
        className="pointer-events-none absolute inset-0 z-[10] bg-[rgba(0,0,0,0.58)]"
        style={{
          maskImage: `url(#${maskId})`,
          WebkitMaskImage: `url(#${maskId})`,
          maskMode: "luminance",
        }}
        aria-hidden
      />

      {/* Overlay buttons (pointer-events-auto only on the buttons themselves). */}
      <div className="pointer-events-none absolute inset-0 z-[20] [transform:translateZ(0)]">
        {rects.map(({ h, rect }) => {
          const focused = focusedFieldId === h.id;
          const hovered = !focused && linkedHoverFieldId === h.id;
          return (
            <button
              key={h.id}
              type="button"
              data-field-box-id={h.id}
              aria-label={`Field ${humanizeFieldName(h.name)}`}
              onPointerEnter={() => onHoverField(h.id)}
              onPointerLeave={() => onHoverField(null)}
              // Stop pointer/mouse-down propagation in capture phase so the
              // ancestor Radix Dialog's outside-pointerdown dismisser can't
              // close the dialog when the operator activates a field. The
              // skill calls this out for click but Radix uses pointerdown
              // for outside detection — `stopPropagation` on click runs
              // too late.
              onPointerDownCapture={(e) => e.stopPropagation()}
              onMouseDownCapture={(e) => e.stopPropagation()}
              onClickCapture={(e) => {
                // Capture phase guarantees the off→on highlight re-enable
                // runs before any ancestor bubble-phase listener can
                // stopPropagation it.
                e.stopPropagation();
                onActivate(h.id);
              }}
              className={cn(
                "absolute pointer-events-auto rounded-[2px] bg-transparent transition-colors",
                focused
                  ? "z-[23] border-2 border-amber-300 ring-2 ring-amber-300/50"
                  : hovered
                    ? "z-[22] border border-sky-300"
                    : "z-[21] border border-neutral-800 outline outline-1 outline-white/60",
              )}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
              }}
            />
          );
        })}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Bottom toolbar                                                             */
/* -------------------------------------------------------------------------- */

function ToolbarButton({
  label,
  pressed,
  outlined,
  disabled,
  onClick,
  children,
  asChild,
}: {
  label: string;
  pressed?: boolean;
  outlined?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  asChild?: { href: string; download?: string };
}) {
  const cls = cn(
    "flex items-center justify-center rounded-md text-zinc-200 transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-40",
    pressed
      ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/60"
      : outlined
        ? "ring-1 ring-white/15 hover:bg-white/[0.06]"
        : "hover:bg-white/[0.06]",
  );
  const style = { width: TOOLBAR_BUTTON_SIZE, height: TOOLBAR_BUTTON_SIZE };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {asChild ? (
          <a
            href={asChild.href}
            download={asChild.download}
            aria-label={label}
            className={cls}
            style={style}
            onClick={onClick}
          >
            {children}
          </a>
        ) : (
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cls}
            style={style}
          >
            {children}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function BottomToolbar({
  zoom,
  setZoom,
  onFitWidth,
  highlightsOn,
  setHighlightsOn,
  panelOpen,
  setPanelOpen,
  downloadHref,
  downloadFilename,
}: {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  onFitWidth: () => void;
  highlightsOn: boolean;
  setHighlightsOn: (b: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;
  downloadHref: string;
  downloadFilename: string;
}) {
  const atMin = zoom <= ZOOM_MIN + 0.001;
  const atMax = zoom >= ZOOM_MAX - 0.001;

  return (
    <div
      // The whole row is non-interactive so it doesn't swallow clicks on the
      // document beneath it; the pill itself re-enables pointer-events.
      className="pointer-events-none absolute inset-x-0 bottom-3 z-[40] flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-zinc-900/95 px-2 py-1 shadow-md shadow-black/40 backdrop-blur">
        <ToolbarButton
          label="Zoom out"
          disabled={atMin}
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))}
        >
          <ZoomOut className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Zoom in"
          disabled={atMax}
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))}
        >
          <ZoomIn className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Fit to width" onClick={onFitWidth}>
          <Maximize className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={highlightsOn ? "Hide field highlights" : "Show field highlights"}
          pressed={highlightsOn}
          onClick={() => setHighlightsOn(!highlightsOn)}
        >
          {highlightsOn ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </ToolbarButton>
        <ToolbarButton
          label="Download PDF"
          asChild={{ href: downloadHref, download: downloadFilename }}
        >
          <Download className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
        <ToolbarButton
          label={panelOpen ? "Hide field panel" : "Show field panel"}
          outlined
          pressed={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? (
            <PanelLeftClose className="size-4" />
          ) : (
            <PanelRight className="size-4" />
          )}
        </ToolbarButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Right panel                                                                */
/* -------------------------------------------------------------------------- */

type SortMode = "page-name" | "name" | "confidence";

function nextSortMode(m: SortMode): SortMode {
  return m === "page-name" ? "name" : m === "name" ? "confidence" : "page-name";
}

function sortModeLabelForNext(m: SortMode): string {
  // Tooltip names the *next* mode that the click will switch to.
  const next = nextSortMode(m);
  return next === "page-name"
    ? "Sort by page"
    : next === "name"
      ? "Sort by name"
      : "Sort by confidence";
}

function RightPanel({
  open,
  onClose,
  loading,
  error,
  highlights,
  activePage,
  setActivePage,
  focusedFieldId,
  linkedHoverFieldId,
  onActivate,
  onHoverField,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  highlights: FieldHighlight[];
  activePage: number;
  setActivePage: (n: number) => void;
  focusedFieldId: string | null;
  linkedHoverFieldId: string | null;
  onActivate: (id: string) => void;
  onHoverField: (id: string | null) => void;
}) {
  // Search + sort live entirely inside the panel — they don't touch
  // `activePage` (only the page filter does that).
  const [pageFilter, setPageFilter] = useState<"all" | number>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("page-name");

  const pagesWithFields = useMemo(() => {
    const s = new Set<number>();
    for (const h of highlights) s.add(h.pageNumber);
    return Array.from(s).sort((a, b) => a - b);
  }, [highlights]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows =
      pageFilter === "all"
        ? highlights
        : highlights.filter((h) => h.pageNumber === pageFilter);
    if (q) {
      rows = rows.filter((h) => {
        const human = humanizeFieldName(h.name).toLowerCase();
        const tech = h.name.toLowerCase();
        const value = formatIdpValue(h.rawValue).toLowerCase();
        return human.includes(q) || tech.includes(q) || value.includes(q);
      });
    }
    const sorted = [...rows];
    if (sortMode === "name") {
      sorted.sort((a, b) =>
        humanizeFieldName(a.name).localeCompare(humanizeFieldName(b.name)),
      );
    } else if (sortMode === "confidence") {
      sorted.sort((a, b) => normalizeConfidence(b.confidence) - normalizeConfidence(a.confidence));
    } else {
      sorted.sort((a, b) =>
        a.pageNumber !== b.pageNumber
          ? a.pageNumber - b.pageNumber
          : humanizeFieldName(a.name).localeCompare(humanizeFieldName(b.name)),
      );
    }
    return sorted;
  }, [highlights, pageFilter, query, sortMode]);

  if (!open) {
    // Reserve the panel's width on the workspace side; the panel itself
    // collapses to zero so the document gets the freed visual width
    // (capped — see `fitCapRef` in the workspace measurement).
    return null;
  }

  const fieldNoun = highlights.length === 1 ? "Field" : "Fields";

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l border-white/[0.06] bg-zinc-950/40"
      style={{ width: RIGHT_PANEL_WIDTH }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <h2 className="text-sm font-medium text-zinc-100">All extracted fields</h2>
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-zinc-200">
          {highlights.length} {fieldNoun}
        </span>
        <button
          type="button"
          aria-label="Hide field panel"
          onClick={onClose}
          className="ml-auto rounded p-1 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-white/[0.06] px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <PageFilterControl
            pages={pagesWithFields}
            value={pageFilter}
            onChange={(p) => {
              setPageFilter(p);
              if (p !== "all") setActivePage(p);
            }}
          />
          <span className="ml-auto" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={searchOpen ? "Hide search" : "Search fields"}
                aria-pressed={searchOpen}
                onClick={() => {
                  const next = !searchOpen;
                  setSearchOpen(next);
                  if (!next) setQuery("");
                }}
                className={cn(
                  "flex size-7 items-center justify-center rounded text-zinc-300 hover:bg-white/[0.06]",
                  searchOpen && "bg-white/[0.08] text-zinc-50",
                )}
              >
                <Search className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {searchOpen ? "Hide search" : "Search fields"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={sortModeLabelForNext(sortMode)}
                disabled={highlights.length < 2}
                onClick={() => setSortMode(nextSortMode)}
                className="flex size-7 items-center justify-center rounded text-zinc-300 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sortMode === "page-name" ? (
                  <ListFilter className="size-4" />
                ) : sortMode === "name" ? (
                  <ArrowDownAZ className="size-4" />
                ) : (
                  <BarChart3 className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{sortModeLabelForNext(sortMode)}</TooltipContent>
          </Tooltip>
        </div>
        {searchOpen ? (
          <input
            type="search"
            className="rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-1 text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:border-white/15 focus:outline-none"
            placeholder="Filter fields"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <PanelSkeleton />
        ) : error ? (
          <div
            role="alert"
            className="m-3 rounded-md border border-rose-900/60 bg-rose-950/40 p-3 text-[12px] text-rose-100"
          >
            <div className="font-medium">Could not load extracted fields</div>
            <p className="mt-1 text-rose-200/80">{error}</p>
          </div>
        ) : highlights.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-zinc-400">
            This run has no extracted fields.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-zinc-400">
            No fields match the current filter.
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {filtered.map((h) => (
              <FieldRow
                key={h.id}
                field={h}
                active={focusedFieldId === h.id}
                hovered={linkedHoverFieldId === h.id}
                isOnActivePage={h.pageNumber === activePage}
                onActivate={onActivate}
                onHoverField={onHoverField}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function PageFilterControl({
  pages,
  value,
  onChange,
}: {
  pages: number[];
  value: "all" | number;
  onChange: (v: "all" | number) => void;
}) {
  // When only one page has fields, render as a static label, not a dropdown
  // (per the skill — dropdowns with a single option are noise).
  if (pages.length <= 1) {
    return (
      <span className="rounded border border-white/[0.06] bg-zinc-900/40 px-2 py-1 text-[11px] text-zinc-300">
        {pages.length === 1 ? `Page ${pages[0]}` : "All pages"}
      </span>
    );
  }
  return (
    <select
      aria-label="Filter by page"
      value={value === "all" ? "all" : String(value)}
      onChange={(e) =>
        onChange(e.target.value === "all" ? "all" : Number(e.target.value))
      }
      className="rounded border border-white/[0.06] bg-zinc-900/60 px-1.5 py-1 text-[11px] text-zinc-200 focus:border-white/15 focus:outline-none"
    >
      <option value="all">All fields</option>
      {pages.map((p) => (
        <option key={p} value={p}>
          Page {p}
        </option>
      ))}
    </select>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-6 w-full animate-pulse rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field row + value chip + confidence bars                                   */
/* -------------------------------------------------------------------------- */

function FieldRow({
  field,
  active,
  hovered,
  isOnActivePage,
  onActivate,
  onHoverField,
}: {
  field: FieldHighlight;
  active: boolean;
  hovered: boolean;
  isOnActivePage: boolean;
  onActivate: (id: string) => void;
  onHoverField: (id: string | null) => void;
}) {
  return (
    <li
      data-field-row-id={field.id}
      className={cn(
        "border-b border-white/[0.04] last:border-b-0",
        active && "bg-amber-500/[0.06]",
        !active && hovered && "bg-sky-500/[0.06]",
      )}
    >
      <button
        type="button"
        onPointerEnter={() => onHoverField(field.id)}
        onPointerLeave={() => onHoverField(null)}
        onClickCapture={() => onActivate(field.id)}
        className="block w-full px-2.5 py-2 text-left hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2">
          <FieldTypeGlyph elementType={field.elementType} />
          <span className="truncate text-[13px] text-zinc-100">
            {humanizeFieldName(field.name)}
          </span>
          <span className="truncate font-mono text-[10px] text-zinc-500">
            {field.name}
          </span>
          <span
            className={cn(
              "ml-auto rounded px-1 text-[10px] font-medium",
              isOnActivePage
                ? "bg-sky-500/20 text-sky-100"
                : "bg-white/[0.06] text-zinc-400",
            )}
          >
            p{field.pageNumber}
          </span>
          <ConfidenceSignalBars c={field.confidence} />
        </div>
        <ValueChip raw={field.rawValue} />
      </button>
    </li>
  );
}

function FieldTypeGlyph({ elementType }: { elementType: string }) {
  // The IDP payload only emits a small set of element_types; we map a glyph
  // per family. Falls back to a generic "field" glyph.
  const Icon =
    elementType === "extracted_field" || elementType === "document_field"
      ? FileText
      : elementType.includes("number")
        ? Hash
        : TypeIcon;
  return <Icon className="size-3.5 text-zinc-400" aria-hidden />;
}

function normalizeConfidence(c: number | null): number {
  if (c == null || !Number.isFinite(c)) return -1;
  if (c >= 0 && c <= 1) return c * 100;
  return c;
}

function ConfidenceSignalBars({ c }: { c: number | null }) {
  const norm = c == null || !Number.isFinite(c) ? null : c <= 1 && c >= 0 ? c * 100 : c;
  const lit = norm == null ? 0 : norm < 55 ? 1 : norm < 85 ? 2 : 3;
  const bucket: "low" | "medium" | "high" | "none" =
    norm == null ? "none" : norm < 55 ? "low" : norm < 85 ? "medium" : "high";
  const fillClass =
    bucket === "low"
      ? "bg-rose-400"
      : bucket === "medium"
        ? "bg-amber-400"
        : bucket === "high"
          ? "bg-emerald-400"
          : "bg-transparent";
  const tooltip =
    norm == null
      ? "No confidence score"
      : c != null && c <= 1 && c >= 0
        ? `Confidence: ${Math.round(norm)}%`
        : `Confidence: ${Math.round(norm)}`;

  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      className="inline-flex items-end gap-[1.5px] align-middle"
    >
      {[4, 7, 10].map((h, i) => (
        <span
          key={i}
          style={{ height: `${h}px`, width: "2px" }}
          className={cn(
            "block rounded-[1px] border border-white/[0.18]",
            i < lit ? fillClass : "bg-transparent",
          )}
        />
      ))}
    </span>
  );
}

function ValueChip({ raw }: { raw: unknown }) {
  const formatted = formatIdpValue(raw) || "—";
  const isEmpty = formatted === "—";
  const isMonoCandidate =
    !isEmpty && formatted.length <= 64 && /^[A-Z0-9_\-./]+$/.test(formatted);
  const isMultiline = formatted.includes("\n");

  return (
    <div
      className={cn(
        "mt-1.5 select-text rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-1.5 text-[13px]",
        isEmpty ? "text-zinc-500" : "text-zinc-100",
        isMonoCandidate && "font-mono",
        isMultiline
          ? "max-h-[120px] overflow-y-auto whitespace-pre-wrap"
          : "overflow-x-auto whitespace-nowrap",
      )}
    >
      {formatted}
    </div>
  );
}
