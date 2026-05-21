# Document Preview Guidance

Use this reference whenever Kognitos application work renders an extracted
document (invoice, ID, form, contract) with the per-field overlay produced by
Kognitos IDP — bounding boxes, confidence, and a side panel of extracted
values. The same patterns apply to any single-document preview built on a
Kognitos run output, not just invoices.

The IDP payload is a free-form `Struct` under
`state.completed.outputs.idp_extraction_results`. The OpenAPI spec does not
schematize its inner shape, so the application owns the contract end-to-end:
parser, overlay geometry, and panel UX must all agree on one canonical
field model.

This guide is opinionated. Every sub-rule below is in response to a real
failure mode that a previous implementation hit and a downstream consumer
noticed. If you skip a rule, expect the failure mode to come back.

## At-a-Glance

**What this document is.** The implementation contract for any
Kognitos-app document preview surface that renders a PDF (or image)
plus IDP-extracted fields. Specifies the parser shape, the layout, the
render pipeline, the overlay model, and the right-panel UX.

**When to read it.** Before starting work that mounts a document
preview, before reviewing a PR that touches one, and whenever the
upstream `idp_extraction_results` shape changes.

**Who must follow it.** Every app implementation, regardless of
framework. The component templates here are reference patterns; the
**rules** in each section are the contract. Where rules and templates
disagree, the rules win.

**How sections are organized.** Layout-first (Window Chrome → Page Rail
→ Render Lifecycle → Document Positioning → Bottom Toolbar → Bounding
Box Overlays → Right Panel), then data contract (IDP Payload Contract),
then plumbing (Document Fetch and Payload Fetch, Embedding in Chat,
State Coverage). Skim the layout sections to plan the UI, then drop
into the contracts when you start writing the parser.

## Composition Diagram

The dialog is a single composite. Each numbered region below maps to a
named section later in this document.

```
┌────────────────────────────────────────────────────────────────────┐
│  ① Dialog header  (title = filename / invoice number, close ✕)    │
├──────────┬───────────────────────────────────────────┬─────────────┤
│          │                                           │             │
│          │                                           │   ⑥ Right   │
│  ② Page  │           ③ Document workspace            │     panel   │
│   rail   │           (canvas + overlay layers)       │   (fields,  │
│  (1 col, │                                           │   confidence│
│   thumb- │                                           │    bars)    │
│   nails) │                                           │             │
│          │                                           │             │
│          │                                           │             │
│          │     ┌───────── ④ Bottom toolbar ─────┐    │             │
│          │     │ ⊖  ⊕  ⤢  ✦  ⬇   │   ⟷ panel ▣ │    │             │
│          │     └─────────────────────────────────┘    │             │
└──────────┴───────────────────────────────────────────┴─────────────┘
   ②: Page Rail (Multi-page Documents)
   ③: Render Lifecycle, Document Positioning, Bounding Box Overlays
   ④: Bottom Toolbar (Document Controls)
   ⑤: (state — see State Coverage)
   ⑥: Right Panel — Extracted Values + Confidence
```

The page rail (②) is hidden for single-page documents. The right panel
(⑥) is collapsible but reserves its width even while collapsed (see
"Document Positioning"). The bottom toolbar (④) floats inside the
workspace — it does not occupy a separate row.

## Default Expectations

- Treat the run payload as canonical. If the parser yields zero highlights,
  log a one-line diagnostic at the fetch boundary and surface a
  user-visible empty state — never render an empty overlay silently.
- Normalize the payload in an adapter, not in the UI. The viewer consumes a
  flat `FieldHighlight[]`; it does not walk protobuf wrappers.
- Drive canvas, mask, and overlay layers from a single `layout` object so
  they pixel-align across zoom and resize.
- Keep all interactive UI (overlay boxes, panel rows, toolbar) keyboard- and
  screen-reader-accessible — overlay buttons get `aria-label`, panel rows
  use real `<button>` elements with focus styling, tooltips have text.
- Open the viewer in a modal dialog. Do not navigate away from the dashboard
  context to view a document. Even chat-launched previews stay in-app —
  see "Embedding the Viewer in a Chat Surface" below.

## Implementation Setup

Two setup pieces must be reproducible across fresh clones and CI. If they
silently fail, the viewer hangs at "loading PDF" with no useful error.

### PDF.js Worker

- Do not load `pdf.worker` from a public CDN. Version skew between the
  API bundle and the CDN-hosted worker silently breaks rendering, and
  the CDN may be unreachable from CI.
- Copy `pdfjs-dist/build/pdf.worker.min.mjs` into the app's static root
  (e.g. `public/pdf.worker.mjs`) during `postinstall` or a pre-build
  script so a fresh clone always has a matching worker on disk.
- Set `GlobalWorkerOptions.workerSrc` to a same-origin absolute URL
  (e.g. `/pdf.worker.mjs`).
- Pin the worker filename to the same `pdfjs-dist` major version the
  app imports. Skew produces opaque "fake worker" warnings and missing
  render output.

Reference `package.json` snippet:

```jsonc
{
  "scripts": {
    "postinstall": "node scripts/copy-pdfjs-worker.mjs",
    "prebuild": "node scripts/copy-pdfjs-worker.mjs"
  }
}
```

Reference copy script (`scripts/copy-pdfjs-worker.mjs`):

```js
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(
  __dirname,
  "..",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
);
const dst = resolve(__dirname, "..", "public/pdf.worker.mjs");

await mkdir(dirname(dst), { recursive: true });
await cp(src, dst);
console.log(`copied ${src} → ${dst}`);
```

Reference viewer init:

```ts
// Dynamic import — pdfjs-dist references DOM globals (Window, document,
// fetch) and crashes a Next.js / Remix / Nuxt server-side render if
// imported at module scope. Always import inside the effect that
// needs it, or behind a `dynamic(() => …, { ssr: false })` boundary.
const pdfjs = await import("pdfjs-dist");
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
const task = pdfjs.getDocument({ url: pdfUrl, withCredentials: false });
const doc = await task.promise;
```

> **Required behavior.** PDF.js MUST be loaded via dynamic import (or
> framework-specific `ssr: false` wrapper). Static `import "pdfjs-dist"`
> at the top of any module that ends up in a server bundle will fail
> with `ReferenceError: window is not defined` at build or first
> request. The error message rarely points at the offending import,
> which makes the failure expensive to diagnose.

### Server Routes

Two server routes own the Kognitos contact surface. The viewer fetches
both via the application's adapter layer; it never sees Kognitos
credentials, file ids, or the Files API directly. The full
implementation lives in "Document Fetch and Payload Fetch" later in
this doc — this subsection is the at-a-glance index.

| Route | Purpose | Returns | Client behavior |
|---|---|---|---|
| `GET /api/.../files/{fileId}` (app-defined) | Stream the document bytes through a server proxy that resolves workspace-vs-org scope. | Binary PDF / image stream. | Pass the route URL straight to `pdfjs.getDocument({ url })` or to an `<img src>`. |
| `GET /api/.../runs/{runId}/payload` (app-defined) | Return the raw IDP payload object for one run. | JSON `{ payload: { ... } }`. | Run through the parser to produce `FieldHighlight[]`; do NOT walk the protobuf shape in the UI. |

Both routes:

- Accept the request from the operator's session, authenticate to
  Kognitos using the *server's* credentials (never expose a Kognitos
  token to the browser), and forward back without transformation.
- Cache nothing implicitly — PDF bytes are large and operator-private,
  IDP payloads change as `book-idp` versions roll. Cache headers
  belong on the upstream Kognitos response, not the proxy.
- The download route MUST implement the workspace-then-org fallback
  chain documented in "Document Fetch and Payload Fetch" → "PDF
  bytes". Skipping the fallback means workspace-scoped files 404
  silently and the viewer hangs at "loading PDF" with no useful error.

## Window Chrome and Color Scheme

The preview is a centered modal with a viewport-relative size, not a
full-screen takeover. Use a three-band dark palette so the document itself
is the only light surface — the eye lands on the page automatically.

> **Design tokens are a recipe, not a literal palette.** The token
> classes shown below (`zinc-*`, `bg-zinc-900/80`, etc.) are the
> reference defaults from the in-repo viewer. Apps with their own
> design system should map these to their own tokens — what is
> contractual is the *contrast hierarchy* (rail/panel slightly lighter
> than the dialog shell, workspace mid-dark, document the only light
> surface), not the specific token names. If your design system has a
> "modal" primitive, use it; do not re-skin a generic surface.

| Surface | Role | Intent |
|---|---|---|
| Dialog shell | Frame around the entire preview | Near-black with a thin neutral border; close button in the dialog header |
| Page rail (left) | Per-page thumbnails for multi-page docs | Slightly lighter than the dialog; thumbnails use a subtle outline when selected |
| Document workspace (center) | The PDF canvas, overlay, dim mask, and bottom toolbar | Mid-dark neutral so a white page reads as "centered on a desk" |
| Right panel | Extracted-fields list and filters | Same family as the page rail; collapsible; never floats over the document |
| Document surface | The PDF page itself | The only white surface in the entire dialog |

Other rules:

- Borders are 1px and neutral. Do not stack drop shadows inside the dialog;
  the modal already has its own elevation.
- Avoid colored backgrounds on the rails. Color is reserved for state
  (focused box, hovered row, active page).
- Dialog header height stays small and shows the document title and the
  close button. Title is the document filename when known (e.g. invoice
  number), falling back to a generic "Document Processing" label. The
  toolbar lives in the workspace footer (see below).

> **Modal vs full-screen is an app convention.** The reference
> implementation uses a centered modal sized at ~90vw × 90vh. Apps with
> a long workflow (e.g. a side-by-side review experience) may instead
> mount the same composition in a route or a side panel. What's
> universal is: stays in-app (no `_blank` tab/window) and preserves the
> three-column composition above. If your app uses a side-panel shape,
> drop the dialog header and let the host surface own the title and
> close affordance.

## Page Rail (Multi-page Documents)

For PDFs with one or more pages, render a vertical thumbnail rail on
the left of the workspace. The rail renders even for single-page
documents — it surfaces a single thumbnail that doubles as a click
target, and (more importantly) keeps the workspace columns from
reflowing when a previously-multi-page run is replaced by a
single-page one in the same dialog.

If your design absolutely requires hiding the rail for single-page
documents, do it via CSS (`hidden` when `pages === 1`) so the layout
slot is preserved in the React tree.

Required behavior:

- One thumbnail per page, rendered through PDF.js at a small fit-width
  (~96px CSS) using the same DPR-aware render pipeline as the main
  canvas, but with a lower DPR cap (~2). Render thumbnails lazily as
  they scroll into view; do not render all pages at mount.
- Active page has a 2px accent ring and a slightly lighter background.
  Inactive pages get a thin neutral outline that brightens on hover.
- Page number caption sits below each thumbnail (small, mono font).
- Click sets `activePage`. The main canvas re-mounts via
  `key={activePage}` (see "Reset Across Runs") and the right-panel
  field list filters to fields on that page.
- Field count badge per thumbnail when highlights exist on that page.
  This makes "the boxes are on page 3" visible at a glance.
- Rail scrolls independently of the main workspace; do not couple
  scrolls. Use `IntersectionObserver` to mark thumbnails visible for
  the lazy renderer.
- Rail width stays fixed (~120px CSS including padding) so resizing the
  dialog doesn't reflow the document.
- Aria: each thumbnail is a `<button>` with
  `aria-current={page === activePage ? "page" : undefined}` and
  `aria-label={\`Page ${page} of ${totalPages}${count ? \`, ${count} fields\` : ""}\`}`.

Reference template:

```tsx
function PageRail({ pdf, pages, activePage, setActivePage, fieldsByPage }) {
  return (
    <nav
      aria-label="Document pages"
      className="flex h-full w-[120px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-white/[0.06] bg-zinc-950/40 p-2"
    >
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
        const count = fieldsByPage[p]?.length ?? 0;
        const active = p === activePage;
        return (
          <button
            key={p}
            type="button"
            onClick={() => setActivePage(p)}
            aria-current={active ? "page" : undefined}
            aria-label={`Page ${p} of ${pages}${count ? `, ${count} fields` : ""}`}
            className={[
              "group relative flex flex-col items-center gap-1 rounded-md p-1.5",
              active
                ? "bg-white/[0.06] ring-2 ring-sky-400"
                : "ring-1 ring-white/[0.05] hover:ring-white/[0.15]",
            ].join(" ")}
          >
            <PageThumbnail pdf={pdf} pageNumber={p} maxCssWidth={96} />
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
```

Reference template for the lazy thumbnail renderer:

```tsx
function PageThumbnail({ pdf, pageNumber, maxCssWidth }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current?.parentElement;
    if (!node || typeof IntersectionObserver === "undefined") {
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
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !ref.current) return;
      // DPR cap of 2 for thumbnails — see Canvas Mount Order.
      /* render into ref.current with DPR-aware scaling */
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber, visible]);

  return <canvas ref={ref} />;
}
```

## Render Lifecycle and Reset

The viewer has four startup-ordering hazards. Each silently produces
"PDF didn't display" symptoms with no console error.

### Canvas Mount Order

- Mount the `<canvas>` as soon as the `PDFDocumentProxy` resolves — NOT
  after layout exists. Layout (`baseW`/`baseH`/`cssW`/`cssH`) is derived
  from the first successful `page.render()`, so gating canvas mount on
  layout produces a circular dependency that never fires.
- Render the active page first, then read `page.getViewport({ scale: 1 })`
  to derive `baseW`/`baseH`, then derive `cssW`/`cssH` for the active zoom.
- Show a lightweight "Rendering…" overlay whenever `layout` is unavailable
  so the operator sees activity instead of an empty workspace.
- Prefer `useLayoutEffect` (not `useEffect`) for the active-page render so
  the canvas paints before the first visible frame when possible.
- Render at device-pixel-ratio for sharpness on Retina / high-DPI
  displays. PDF.js renders at scale 1 by default; without the DPR
  transform the canvas will be visibly blurry. Cap DPR at ~3 for the
  active page (and ~2 for thumbnails) so 4K iPad displays don't burn
  frames rendering at 4×.

Reference template for the page component:

```tsx
function PdfPageWithHighlights({ pdf, pageNumber1, maxCssWidth, ... }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageBase, setPageBase] = useState<{ baseW: number; baseH: number } | null>(null);

  // Read base viewport once per page change.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageNumber1);
      if (cancelled) return;
      const baseVp = page.getViewport({ scale: 1 });
      setPageBase({ baseW: baseVp.width, baseH: baseVp.height });
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber1]);

  const layout = useMemo(
    () => layoutForZoom(pageBase, maxCssWidth),
    [pageBase, maxCssWidth],
  );

  // Render synchronously w.r.t. layout commits so the page paints before
  // the first visible frame whenever possible.
  useLayoutEffect(() => {
    if (!layout) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      const page = await pdf.getPage(pageNumber1);
      if (cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = layout.cssW / layout.baseW;
      const vp = page.getViewport({ scale });

      // DPR-aware sizing: backing-store at cssW × dpr, displayed at cssW.
      // Cap DPR at 3 so 4K displays don't burn frames; thumbnail rail
      // uses 2 (see Page Rail section).
      const dpr = typeof window !== "undefined"
        ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
        : 1;
      canvas.width  = Math.max(1, Math.floor(layout.cssW * dpr));
      canvas.height = Math.max(1, Math.floor(layout.cssH * dpr));
      canvas.style.width  = `${layout.cssW}px`;
      canvas.style.height = `${layout.cssH}px`;

      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        // PDF.js renders into the backing-store coordinate space; the DPR
        // transform scales its drawing to fill the higher-resolution canvas.
        transform: dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as const) : undefined,
      });
      try { await task.promise; } catch { /* cancelled render */ }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber1, layout]);

  return (
    <div style={layout ? { width: layout.cssW, height: layout.cssH } : { width: maxCssWidth, minHeight: 200 }}>
      {!layout ? <RenderingOverlay pageNumber={pageNumber1} /> : null}
      <canvas ref={canvasRef} />
      {layout && overlayEnabled ? <DimAndOverlayLayers layout={layout} /> : null}
    </div>
  );
}
```

> **Required behavior — patterns differ but the contract is fixed.** Any
> rendering implementation must (a) mount the canvas before layout is
> known, (b) render at DPR with a capped transform, and (c) cancel
> in-flight renders on prop change (see next section).

### Render-task Cancellation

`page.render()` returns a `RenderTask` that owns the canvas's 2D context
until its promise resolves. If a second `render()` is started against
the same canvas (zoom change, page change, or React re-render) before
the previous task is cancelled, PDF.js throws
`Cannot use the same canvas during multiple render() operations`. This
surfaces as a half-painted page that never recovers.

Rules:

- Hold the active `RenderTask` in a ref (one per canvas).
- On every effect entry: if a previous task is still running, call
  `cancel()` on it and `await` its rejection (caught silently) before
  starting a new one.
- On effect cleanup: `cancel()` the task. Do not rely on cleanup-on-prop
  change to also abort the underlying byte stream — call `cancel()`
  explicitly.
- Cancellation surfaces as a `RenderingCancelledException`. Treat it as
  expected control flow, not an error.

Reference template (drop into the `useLayoutEffect` from "Canvas Mount
Order"):

```tsx
const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);

useLayoutEffect(() => {
  if (!layout) return;
  let cancelled = false;
  const canvas = canvasRef.current;
  if (!canvas) return;

  void (async () => {
    // Tear down a previous render before starting a new one. If we don't,
    // PDF.js throws "Cannot use the same canvas during multiple render()".
    const prev = renderTaskRef.current;
    if (prev) {
      prev.cancel();
      try { await prev.promise; } catch { /* expected RenderingCancelledException */ }
      renderTaskRef.current = null;
    }
    if (cancelled) return;

    const page = await pdf.getPage(pageNumber1);
    if (cancelled) return;
    /* ...sizing as in Canvas Mount Order template... */

    const task = page.render({ canvasContext: ctx, viewport: vp, transform });
    renderTaskRef.current = task;
    try { await task.promise; } catch { /* cancelled */ }
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
}, [pdf, pageNumber1, layout]);
```

### Initial Page Sync

- After fields load, set the active page to `min(field.pageNumber)` across
  the parsed highlights (default to `1` only when there are none).
- Guard against an unconditional `setPageNum(1)` in the PDF-load effect —
  if it runs after the field-driven set, every box ends up on a page the
  operator never navigates to.

Reference:

```ts
useEffect(() => {
  if (parsedHighlights.length === 0) return;
  const first = Math.min(...parsedHighlights.map((h) => h.pageNumber));
  setActivePage(first);
}, [parsedHighlights]);
```

### Reset Across Runs

- Mount the viewer with `key={runId}` (or equivalent) so all state and
  refs reset when the operator switches to a different run. The viewer's
  own `runId`-keyed effects are belt-and-suspenders; the `key` is the
  belt.
- Mount the per-page renderer with `key={activePage}` so layout/render
  refs (canvas size, `RenderTask`, `pageBase`) reset cleanly when the
  page changes. Otherwise a stale `pageBase` from the previous page
  briefly drives layout for the new page and the dim mask scopes to
  the wrong rectangle for one frame.
- Reset `highlightsOn` to `true` when the dialog closes, unless preference
  persistence is intentionally implemented.

```tsx
{open ? (
  <InvoicePdfHighlightViewer
    key={runId}
    pdfUrl={pdfUrl}
    runId={runId}
  />
) : null}

// Inside the viewer, the per-page renderer:
<PdfPageWithHighlights
  key={activePage}
  pdf={pdf}
  pageNumber1={activePage}
  maxCssWidth={maxCssWidth}
  highlights={highlightsOnActivePage}
/>
```

### Aborting In-flight Requests

- Wrap the payload fetch in an `AbortController`; abort on dialog close
  AND on `runId` change. Optionally abort the PDF fetch the same way.
- This prevents a late response from a previous run from overwriting
  state for the current run — a class of bug that surfaces as
  "wrong invoice's fields appear in the panel".

```ts
useEffect(() => {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`/api/kognitos/runs/${runId}/payload`, {
        signal: ctrl.signal,
      });
      const json = await res.json();
      setParsedHighlights(parseIdpInvoiceFieldHighlights(json.payload));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setPayloadError("Could not load run payload.");
    } finally {
      setPayloadLoading(false);
    }
  })();
  return () => ctrl.abort();
}, [runId]);
```

## Document Positioning

The document fits the workspace width on first render and stays centered
through every zoom and panel-toggle. Three rules drive this:

1. **Single source of truth for layout.** Read PDF.js base viewport once
   (`{ baseW, baseH }` at scale 1), then derive `cssW`/`cssH` for the
   active zoom in one helper. Use the same numbers for the canvas size,
   the SVG mask viewBox, and the overlay container. Do not let PDF.js
   compute a viewport per layer — floating-point drift will desync them.
2. **Reserve the side-panel width even while the panel is collapsed.**
   Subtract a fixed panel-width constant (mirroring the panel's max width)
   from the workspace measurement. This prevents the document from
   reflowing when the user opens the panel for the first time.
3. **Lock the fit cap when the panel is open.** Once measured with the
   panel open, stash that cap in a ref. When the panel is later closed,
   `min(cap, currentRaw)` keeps the document at the narrower size and
   only re-centers — no surprise enlargement.

Reference helper:

```ts
type PageLayout = { baseW: number; baseH: number; cssW: number; cssH: number };

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
```

Render the page in a vertically scrollable container above a sticky bottom
toolbar (see next section). Re-fit on `ResizeObserver` callbacks so window
resize and dialog resize behave the same.

## Bottom Toolbar (Document Controls)

A pill-shaped, floating toolbar pinned to the bottom of the workspace.

**Mount the toolbar as a sibling of the scrolling workspace, not a
descendant.** The center column should be a flex column whose children
are (1) any optional banner, (2) the scrollable workspace, (3) the
toolbar strip. Mounting the toolbar inside the scroll container lets
it move with the document on scroll instead of staying pinned at the
bottom — a regression that ships repeatedly and is hard to spot in PR
review because it only manifests when the document is taller than the
viewport.

| Order | Control | Notes |
|---|---|---|
| 1 | Zoom out | Disabled at min zoom |
| 2 | Zoom in | Disabled at max zoom |
| 3 | Fit to width | Resets to fit-cap |
| 4 | Toggle field highlights | **Highlight overlay toggle, NOT a confidence control.** Pressed-state visually distinct (subtle accent fill); `aria-pressed` + `aria-label` reflect current state |
| 5 | Download PDF | Streams from the document fetch endpoint |
| — | Divider | Visually separates document controls from panel control |
| 6 | Toggle right panel | Distinct visual treatment (outlined) so it reads as "panel" not "document"; `aria-pressed`, `aria-expanded`, `aria-label` reflect current state |

Rules:

- Buttons are square (~31×31 px **reference default** — apps may tune
  to match their button density), neutral hover, tooltip-on-top.
- The container row is `pointer-events-none` so it does not block document
  clicks; the pill itself re-enables pointer events. This matters when the
  toolbar overlaps the bottom of the document during zoom.
- The container needs an explicit high `z-index` (above any wrapping
  `ScrollArea`). Without this, ScrollArea or its scrollbar swallows
  zoom and toggle clicks at the bottom of the workspace.
- Tooltips switch text by state (e.g. "Show field highlights" /
  "Hide field highlights"). Generic "Toggle" labels are not enough.
- Tooltips MUST be wrapped in a single `<TooltipProvider>` (Radix-style
  scoping) at or above the dialog root. Without one, every tooltip
  re-mounts its own provider, opening times stagger by ~150ms and the
  toolbar feels laggy. If your design system already provides a
  TooltipProvider at the app shell, you do not need to add another
  one — but verify it is in the dialog's React tree.
- Disabled-state for zoom limits is required — do not let the operator
  click into a no-op.
- Min/max zoom and step factor are constants near the component. Pick a
  step that yields ~12% change per click so two clicks roughly double or
  halve the perceived size.
- The toolbar re-centers itself on workspace resize via the same fit
  measurement used for the document. Because the toolbar is a sibling
  of the scroll container (above), centering means `flex justify-center`
  on the strip, not `position: absolute; left/right: 0`.

> **Pixel sizes throughout this doc are reference defaults.** Numbers
> like ~31×31 px (toolbar buttons), ~96px CSS (thumbnail width),
> ~120px (page rail width), ~320px (right panel width), and the
> 90vw × 90vh dialog size are the values used in the in-repo reference
> viewer. Apps with different design-system densities can tune them.
> What is fixed is the *relationship* (rail thinner than panel, panel
> thinner than workspace) and the constraints called out in each
> section (e.g. "the right panel reserves its width even while
> collapsed" — the number itself can change).

## Bounding Box Overlays

Three layers, all sized in CSS pixels matching the canvas exactly:

1. **SVG `<defs><mask>`** sized `cssW × cssH`. Inside the mask, draw a
   white rect over the whole page, then a black rect per field bbox. This
   is a luminance mask — black areas become transparent in the dim layer.
2. **Dim layer** (`pointer-events-none`, z-index 10). A solid
   semi-transparent dark fill (~58% opacity for legibility on white
   scanned paper) covers the entire page; the mask cuts holes only where
   field boxes sit, producing a "spotlight" effect. Do not use
   `backdrop-filter` — it doubles the cost without improving legibility.
3. **Overlay button layer** (z-index 20). One transparent `<button>` per
   field, positioned in either CSS percentages (when the bbox is
   normalized) or scaled PDF-point units. Three visual states stacked by
   z-index inside the layer:
   - Idle (z-21): neutral white border, **transparent background**, no fill.
   - Linked-hover from panel (z-22): cool accent border (e.g. sky), still
     transparent background.
   - Focused (z-23): warm accent border + outer ring (e.g. amber). Only
     one box is focused at a time.

Hover state is bidirectional: pointer enter on either the box or the
panel row sets a `linkedHoverFieldId`; both sides observe it. Activation
(click) sets a `focusedFieldId`, jumps to the field's page, scrolls the
panel row into view, and scrolls the box into the document viewport.

Coordinate mode is per-field, inferred from the decoded bbox magnitudes
(see "IDP Payload Contract" below). Both modes resolve into the same
percentage layout against the PDF base viewport, so the overlay code does
not branch on units.

### Filter Coupling

The bbox overlay layer and the right-panel field list are filtered
independently:

- The **bbox layer** filters strictly by `pageNumber === activePage`.
- The **panel list** layers any user-controlled filters (page-filter
  dropdown, search query, sort) on top of the full field list.

Coupling the bbox layer to the panel filter (e.g. `pageNumber === activePage && (pageFilter === "all" || pageFilter === pageNumber)`) hides bboxes the user expects to see — the panel filter is for narrowing the *list*, not for hiding overlays on the page they're currently looking at.

### Hit-Target Wiring

Cross-surface activation (click a panel row → scroll the box; click a
box → scroll the row) needs a stable handle on the DOM nodes for both
sides. Use `data-*` attributes — not refs, not CSS class scans — so the
wiring survives re-renders and key changes:

- Each bounding-box `<button>` gets `data-field-box-id={field.id}` and
  is keyed by `field.id`.
- Each right-panel row container gets `data-field-row-id={field.id}`.
- The cross-surface scroll function is a single helper that does
  `document.querySelector(\`[data-field-box-id="${id}"]\`)` (or the
  matching row attribute), so callers don't reimplement DOM lookup.
- These attributes are part of the public hit-target contract — do not
  rename them in component refactors without updating the helper.

```tsx
// Bounding-box button
<button
  type="button"
  data-field-box-id={field.id}
  aria-label={`Field ${field.displayName}`}
  onPointerEnter={() => onHighlightLinkPointerEnter(field.id)}
  onPointerLeave={() => onHighlightLinkPointerLeave(field.id)}
  onClickCapture={() => onHighlightLinkActivate(field.id)}
  /* ...positioning, classes, transparent bg... */
/>
```

The `onHighlightLinkPointerEnter` / `onHighlightLinkPointerLeave`
handlers MUST be the same race-safe parent-side callbacks the
right-panel rows use (functional `setLinkedHoverFieldId((cur) => cur === id ? null : cur)`). Wiring the bbox button's `onPointerLeave`
directly to `setLinkedHoverFieldId(null)` races with row-side enter
handlers — see "Field Row Layout" below for the same pattern.

```tsx
// Right-panel row
<li data-field-row-id={field.id} /* ...row classes... */>
  {/* ...row content... */}
</li>
```

See "Bidirectional Scroll Synchronization" below for the helper that
consumes these attributes.

### Stacking, Isolation, and Mask Scope

- Wrap canvas + mask + overlay layers in a `position: relative` container
  with `isolation: isolate` so z-index inside the viewer doesn't leak into
  ancestor stacking contexts (and vice-versa).
- The dim-layer wrapper uses `pointer-events-none`; only the per-field
  `<button>` elements use `pointer-events-auto`. A wrapper that captures
  pointer events will swallow clicks meant for the document.
- Bounding-box buttons MUST have transparent backgrounds — only border
  (and the outer ring on focus) is visible. A non-transparent fill hides
  the document and defeats the spotlight effect.
- SVG `<mask>` ids MUST be generated with `useId()` and sanitized to a
  legal SVG id (strip `:`). Two open dialogs — or hydration of a single
  dialog — produce duplicate ids that break `mask="url(#…)"` references
  and the dim layer goes fully opaque or fully transparent.
- Mask cutout rectangles MUST set `shapeRendering="crispEdges"`.
  Without it, sub-pixel anti-aliasing softens the rectangle edges and
  the dim layer's "spotlight" cutouts look fuzzy at the perimeter.
- If boxes still vanish under the dim plane while inspecting layers in
  DevTools, force the overlay wrapper into its own GPU layer
  (`transform-gpu` or `transform: translateZ(0)`) to win the stacking
  contest.

Reference template:

```tsx
function PdfPageOverlay({ layout, highlights }) {
  const rawId = useId();
  // SVG ids cannot contain ":"; sanitize for portability across
  // hydration + multi-dialog mounts.
  const maskId = `inv-dim-${rawId.replace(/:/g, "")}`;

  return (
    <div className="relative" style={{ isolation: "isolate" }}>
      <canvas /* ... */ />
      <svg className="pointer-events-none absolute h-0 w-0 overflow-visible">
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={0} y={0}
            width={layout.cssW} height={layout.cssH}
          >
            <rect width={layout.cssW} height={layout.cssH} fill="white" />
            {highlights.map((h) => {
              const r = highlightBboxRectCss(h, layout);
              return (
                <rect
                  key={h.id}
                  x={r.x} y={r.y}
                  width={r.w} height={r.h}
                  fill="black"
                  shapeRendering="crispEdges"
                />
              );
            })}
          </mask>
        </defs>
      </svg>
      <div
        className="pointer-events-none absolute inset-0 z-[10] bg-[rgba(0,0,0,0.58)]"
        style={{
          maskImage: `url(#${maskId})`,
          WebkitMaskImage: `url(#${maskId})`,
          maskMode: "luminance",
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 z-[20]">
        {highlights.map((h) => (
          <HighlightButton key={h.id} h={h} /* pointer-events-auto, transparent bg */ />
        ))}
      </div>
    </div>
  );
}
```

### Visibility and Usability

- Enforce a minimum bounding-box width and height (e.g. ~12px or ~1% of
  page width, whichever is larger). Without this, a degenerate normalized
  bbox collapses to a zero-area button that can't be clicked.
- On white scanned paper the default neutral border barely reads. Improve
  contrast with: a slightly stronger dim alpha (~58%), a dark bbox border
  (e.g. `neutral-800`), and a thin light outer ring (1px white at ~60%
  opacity). The light ring lifts the box off both the page and the dim
  fill.
- A click on a bounding-box button must re-enable highlights when they
  are off — see "Highlight Visibility Coordination" in the Right Panel
  section.

### Bidirectional Scroll Synchronization

Activating a field on either surface scrolls the *other* surface to
match. The viewer has two independent scroll containers — the document
workspace (often a `ScrollArea`) and the panel list — so a single
`scrollIntoView` won't fix both.

Failure mode without this discipline: clicking a panel row jumps the
page but the box ends up off-screen; clicking a box on the page never
brings the row into view.

Rules:

- One helper per direction (`scrollBoxIntoView(id)`,
  `scrollRowIntoView(id)`). Both look up nodes via the `data-*`
  attributes from "Hit-Target Wiring".
- The first frame after activation may not have committed layout for
  the new active page yet. Re-attempt across **multiple
  `requestAnimationFrame` ticks** (3 is the practical sweet spot)
  before giving up. A `pendingScrollRef` lets the helper re-fire on
  the next layout commit if the node is still missing.
- Use `scrollIntoView({ behavior: "auto", block: "nearest" })` for
  programmatic scrolls — `smooth` interferes with the multi-rAF retry
  and feels laggy on cross-surface activation.
- After scrolling the box, also nudge the panel row (and vice-versa)
  in the same handler. Do not depend on user follow-up gestures.
- Cancel a pending scroll on `runId` change, dialog close, or
  `activePage` change so a stale id doesn't run after the user moves
  on.

Reference helper:

```ts
const pendingScrollRef = useRef<{ id: string; kind: "box" | "row" } | null>(null);

function scrollFieldNodeIntoView(id: string, kind: "box" | "row") {
  const sel = kind === "box"
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
      // Layout still not committed — leave a pending marker so the
      // next render's layout effect can fire it.
      pendingScrollRef.current = { id, kind };
    }
  };

  requestAnimationFrame(tick);
}

// Activation handler does both surfaces in one pass:
const onActivateField = useCallback((id: string) => {
  if (!highlightsOnRef.current) setHighlightsOn(true);
  setFocusedFieldId(id);
  const h = parsedHighlightsRef.current.find((x) => x.id === id);
  if (h) setActivePage(h.pageNumber);
  scrollFieldNodeIntoView(id, "box");
  scrollFieldNodeIntoView(id, "row");
}, []);

// Replay any pending scroll on layout commit (e.g. after activePage change).
useLayoutEffect(() => {
  const p = pendingScrollRef.current;
  if (!p) return;
  pendingScrollRef.current = null;
  scrollFieldNodeIntoView(p.id, p.kind);
}, [activePage, focusedFieldId]);
```

## Right Panel — Extracted Values + Confidence

A collapsible side panel rendered to the right of the document, never
floating over it. Width matches the constant reserved by the document
fit measurement (typically ~320 px, capped at viewport width on small
screens).

Header:

- Title (e.g. "All extracted fields").
- Pill counter ("13 Fields", with the singular spelled out at 1).
- Close button.

Field rows (see "Field Row Layout" below for the full template):

- Type icon (monospace text icon for plain fields).
- Humanized field label (e.g. `Vendor Invoice Number`) — see "Field
  Labels" below.
- Page badge (`p1`, `p2`).
- Three-bar signal-style confidence meter — see "Confidence Signal
  Bars" below.
- The extracted value rendered as a humanized chip on its own row, with
  explicit overflow constraints — see "Read-only Value Chip" and
  "Value Formatting" below.

Interactions:

- Hover sets `linkedHoverFieldId` (two-way with overlay).
- Activate (click) sets `focusedFieldId`, switches the document to the
  field's page, scrolls the box into view in the document, scrolls the
  row into view inside the panel.
- Empty filter result shows a quiet inline message; the empty-payload
  state shows a different message that tells the operator the run had
  no extracted fields.

### Toolbar Row

The toolbar sits between the panel header and the field list. It is
single-row at the panel's typical width (~320px) and wraps to two rows
only when search is active.

| Control | Behavior | Empty state |
|---|---|---|
| Page filter (dropdown) | "All fields" by default; one entry per page **present in the parsed highlights** — never per page in the PDF. Selecting a page filters the field list to that page AND sets `activePage`. | When only one page has fields, render as a static label, not a dropdown. |
| Search toggle (icon-button) | Toggles a single-line filter input that drops in **below** the toolbar (does not push the field list off-screen). Input filters case-insensitively across the humanized label, the technical name, and the formatted value. Trim whitespace before matching. | Hide the input when toggled off; reset query when toggled off, not when the dialog closes. |
| Sort cycle (icon-button) | One button that cycles through three modes: `page + name` (default), `name A–Z`, `confidence high-first`. The icon swaps per mode; the tooltip names the **next** mode (`Sort by name`, `Sort by confidence`, `Sort by page`). | Disabled when fewer than 2 fields exist. |

Rules:

- All three controls are square icon-buttons (~28×28 px), not text. The
  panel is too narrow to host text-bearing controls without crowding
  the field list.
- Tooltips are mandatory — operators discover modes by hover, not by
  trial and error.
- The page-filter dropdown is the **only** control that side-effects
  `activePage`. Sort and search must not navigate the document.
- Search and sort state are panel-local, not viewer-local. Reset on
  dialog close (not on `runId` change inside an open dialog) so
  the operator can compare two runs without losing their filter.

```tsx
<div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2 py-1.5">
  <PageFilterDropdown pages={pagesWithFields} value={pageFilter} onChange={setPageFilter} />
  <span className="ml-auto" />
  <IconButton aria-label={searchOpen ? "Hide search" : "Search fields"} aria-pressed={searchOpen} onClick={toggleSearch}>
    <Search className="size-4" />
  </IconButton>
  <IconButton aria-label={sortNextLabel(sortMode)} onClick={cycleSortMode}>
    <SortIcon mode={sortMode} className="size-4" />
  </IconButton>
</div>
{searchOpen ? (
  <input
    type="search"
    className="mx-2 mb-1.5 rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-1 text-[12px] text-zinc-100 placeholder:text-zinc-500"
    placeholder="Filter fields"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    autoFocus
  />
) : null}
```

### Confidence Signal Bars

A three-bar meter, not a percentage badge. The bars communicate
"low / medium / high" at a glance and stay legible at panel widths
where digits would crowd the row.

Visual contract:

- Three vertical bars, increasing height left → right (e.g. 4 / 7 / 10
  px), 2px wide, 1.5px gap. Container is fixed-size so the row layout
  doesn't reflow per field.
- Bar color encodes the **bucket**, not the raw number: `low` (zinc /
  red), `medium` (amber), `high` (emerald). Inactive bars use a faint
  outline only.
- Tooltip text is mandatory and varies by input shape:
  - Fractional input (`0–1`) → `"Confidence: 98%"` (rounded).
  - Larger input → render the bare number (`"Confidence: 73"`).
  - `null` / missing → `"No confidence score"`.

Bucketing:

| Confidence (normalized to 0–100) | Bars lit | Bucket |
|---|---|---|
| `null` / missing | 0 | n/a |
| `< 55` | 1 | low |
| `< 85` | 2 | medium |
| `≥ 85` | 3 | high |

Reference template:

```tsx
function ConfidenceSignalBars({ c }: { c: number | null }) {
  const norm = c == null ? null : c <= 1 ? c * 100 : c;
  const lit = norm == null ? 0 : norm < 55 ? 1 : norm < 85 ? 2 : 3;
  const bucket: "low" | "medium" | "high" | "none" =
    norm == null ? "none" : norm < 55 ? "low" : norm < 85 ? "medium" : "high";
  const fill = {
    low: "bg-rose-400",
    medium: "bg-amber-400",
    high: "bg-emerald-400",
    none: "bg-transparent",
  }[bucket];
  const tooltip =
    norm == null
      ? "No confidence score"
      : c! <= 1
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
          className={[
            "block rounded-[1px] border border-white/[0.18]",
            i < lit ? fill : "bg-transparent",
          ].join(" ")}
        />
      ))}
    </span>
  );
}
```

### Read-only Value Chip

The extracted value is its own row beneath the field label, not
adjacent to it. At panel widths, side-by-side label + value gives both
fields too little room and forces ellipsis on values that operators
specifically came to read.

Constraints:

- Background: `bg-zinc-900/60`. Border: 1px `border-white/[0.06]`.
  Padding: `px-2 py-1.5`.
- Font: 13px sans for normal values. Switch to mono when the value
  matches `^[A-Z0-9_\-./]+$` and is at most 64 chars (invoice numbers,
  IDs) so digits align cleanly.
- **Single-line by default** with horizontal `overflow-x-auto`. Multi-
  line values (formatted dictionaries) get `whitespace-pre-wrap` AND a
  `max-h-[120px]` with `overflow-y-auto`. Without the height cap, a
  large nested dictionary balloons the row past the viewport.
- Empty/null formatted output (`"—"` from `formatIdpValue`) renders as
  a quieter color (`text-zinc-500`) so the operator can scan past
  empty fields quickly.
- Selectable text (`select-text`) — operators copy invoice numbers and
  PO numbers from this chip directly into other systems.

```tsx
function ValueChip({ raw }: { raw: unknown }) {
  const formatted = formatIdpValue(raw) || "—";
  const isEmpty = formatted === "—";
  const isMonoCandidate =
    !isEmpty && formatted.length <= 64 && /^[A-Z0-9_\-./]+$/.test(formatted);
  const isMultiline = formatted.includes("\n");

  return (
    <div
      className={[
        "select-text rounded border border-white/[0.06] bg-zinc-900/60 px-2 py-1.5 text-[13px]",
        isEmpty ? "text-zinc-500" : "text-zinc-100",
        isMonoCandidate ? "font-mono" : "",
        isMultiline
          ? "max-h-[120px] overflow-y-auto whitespace-pre-wrap"
          : "overflow-x-auto whitespace-nowrap",
      ].join(" ")}
    >
      {formatted}
    </div>
  );
}
```

### Field Row Layout

Composes the above into a single row. The label cluster (icon, label,
mono name, page badge, signal bars) shares one flex line; the value
chip drops to the next line so it can claim full row width.

```tsx
<li
  key={h.name}
  data-field-row-id={h.id}
  className="border-b border-white/[0.04] last:border-b-0"
>
  <button
    type="button"
    onPointerEnter={() => setLinkedHoverFieldId(h.id)}
    onPointerLeave={() => setLinkedHoverFieldId((cur) => (cur === h.id ? null : cur))}
    onClickCapture={() => onActivateField(h.id)}
    className="block w-full px-2.5 py-2 text-left hover:bg-white/[0.03]"
  >
    <div className="flex items-center gap-2">
      <FieldTypeGlyph kind={h.elementType} />
      <span className="truncate text-[13px] text-zinc-100">{humanizeFieldName(h.name)}</span>
      <span className="truncate font-mono text-[11px] text-zinc-500">{h.name}</span>
      <span className="ml-auto text-[11px] text-zinc-500">p{h.pageNumber}</span>
      <ConfidenceSignalBars c={h.confidence} />
    </div>
    <ValueChip raw={h.rawValue} />
  </button>
</li>
```

### Value Formatting

The extracted-value chip MUST render a humanized string. `JSON.stringify`
on the raw IDP value produces unreadable output (`{"text":"INV-112233"}`,
or worse: decimal-bit triplets). Recurse through the same Struct
unwrapper used for `bounding_box` (see "IDP Payload Contract") and:

- Prefer keys in this order when present: `text`, `normalized_value`,
  `extracted_value`. Fall through to the recursive formatter when none
  match.
- Format primitives directly: strings as-is; booleans as "Yes" / "No";
  plain numbers via `toLocaleString`; decimal-bit numbers through the
  shared decoder.
- Format dictionaries by joining `"<humanized key>: <humanized value>"`
  lines.
- Format lists by joining `humanized(item)` with commas.
- Detect "list-shaped objects" — dictionaries whose keys are all numeric
  strings (`"0"`, `"1"`, `"2"`, …) — and format them as lists. Do NOT
  prefix each value with `0:`, `1:`, etc.

Reference template:

```ts
import { decodeIdpValue, decodeStructDecimal } from "@/lib/kognitos/idp";

const PREFER_KEYS = ["text", "normalized_value", "extracted_value"];

/** Title-case a snake_case identifier ("vendor_invoice_number" → "Vendor Invoice Number"). */
export function humanizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isListShapedDict(d: Record<string, unknown>): boolean {
  const keys = Object.keys(d);
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

export function formatIdpValue(raw: unknown): string {
  // 1. Unwrap protobuf Value / Struct wrappers + Decimal bits.
  const v = decodeIdpValue(raw);

  // 2. Primitives.
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString() : "—";

  // 3. Decimal-bit object (post-unwrap shape, before flat number).
  const dec = decodeStructDecimal(v);
  if (dec !== null) return dec.toLocaleString();

  // 4. Lists.
  if (Array.isArray(v)) return v.map(formatIdpValue).filter(Boolean).join(", ");

  // 5. Dictionaries — prefer text/normalized_value/extracted_value first.
  if (v && typeof v === "object") {
    const dict = v as Record<string, unknown>;
    for (const k of PREFER_KEYS) {
      if (k in dict) return formatIdpValue(dict[k]);
    }
    if (isListShapedDict(dict)) {
      return Object.keys(dict)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => formatIdpValue(dict[k]))
        .filter(Boolean)
        .join(", ");
    }
    return Object.entries(dict)
      .map(([k, val]) => `${humanizeFieldName(k)}: ${formatIdpValue(val)}`)
      .join("\n");
  }

  return "—";
}
```

### Field Labels — Technical Name vs Humanized

- Keep the technical `name` (e.g. `vendor_invoice_number`) as the React
  `key`, the value used in logs, and the value behind the
  `data-field-row-id` attribute used by hit-target wiring.
- Render a separate humanized UI label as the row's primary text — title
  case with `_` replaced by space (`Vendor Invoice Number`).
- Keep the monospace `name` chip visible as a secondary label so operators
  can copy the technical id when filing tickets.
- The full row composition lives in "Field Row Layout" above so the
  template doesn't drift between sections.

### Highlight Visibility Coordination

- When `highlightsOn === false`, clicking a row, the row's confidence
  meter, OR a bounding-box button on the document MUST call
  `setHighlightsOn(true)` before applying focus side-effects. Otherwise
  the operator clicks a row, sees the page change, but no visible
  highlight appears — and assumes the viewer is broken.
- Do NOT short-circuit the focus action on the off→on transition; re-enable
  AND focus in the same handler so the user sees the box light up
  immediately.
- For bounding-box buttons, wire activation through `onClickCapture`,
  not `onClick`. The dim-overlay layer below the buttons may listen for
  bubble-phase clicks (e.g. close-on-outside, deselect on background
  click), and the off→on transition needs to fire **before** any
  ancestor handler can `stopPropagation` or otherwise pre-empt the
  re-enable. If the codebase uses `onClick` exclusively, an explicit
  `event.stopPropagation()` after the `setHighlightsOn(true)` call is a
  smaller alternative — but `onClickCapture` is the safer default
  because it documents intent.

```tsx
// Bounding-box button — capture phase guarantees re-enable runs first.
<button
  type="button"
  data-field-box-id={field.id}
  onClickCapture={() => onActivateField(field.id)}
  /* ...positioning, classes, transparent bg... */
/>
```

```ts
const onActivateField = useCallback((id: string) => {
  if (!highlightsOnRef.current) setHighlightsOn(true);
  setFocusedFieldId(id);
  const h = parsedHighlightsRef.current.find((x) => x.id === id);
  if (h) setActivePage(h.pageNumber);
  scrollFieldNodeIntoView(id, "box");
  scrollFieldNodeIntoView(id, "row");
}, []);
```

## IDP Payload Contract

The IDP payload contract — paths, tree shape, element-type aliases,
number decoding (including the C# `Decimal.GetBits` decoder), bbox
coordinate mode inference, the per-page Y-axis flip selector, and
the name blocklist — lives in the dedicated
[`kognitos-idp-payload`](../../kognitos-idp-payload/SKILL.md) skill,
along with a copy-pasteable reference adapter, a fixture matrix that
covers every known payload-shape variant, and a diagnostics surface.

The viewer described in this document consumes the adapter's flat
`FieldHighlight[]` output. Rules of thumb:

- Normalize the payload in an adapter, not in the UI. The viewer
  consumes a flat `FieldHighlight[]`; it does not walk protobuf
  wrappers.
- One adapter per app, not per surface — document preview, exception
  review, and fact-editing all read the same flat field list.
- If your run produces zero highlights, the
  `kognitos-idp-payload` skill's diagnostics reference is the
  fastest way to identify which layer of the contract is failing.

See [`kognitos-idp-payload`](../../kognitos-idp-payload/SKILL.md) for
the full contract, the reference adapter, the fixture matrix, and
the diagnostics surface.

## Document Fetch and Payload Fetch

Two server endpoints owned by the application's adapter layer. The viewer
consumes URLs only — it does not see Kognitos credentials or file ids.

- **PDF bytes:** stream the document through a server route that resolves
  the file id from the run inputs and downloads via the Files API.

  **Try the workspace-scoped endpoint first** when a workspace id is
  available — files created under an automation or workspace return `404`
  from the org-only download endpoint:

  ```
  organizations/{org}/workspaces/{workspace}/files/{file}:download   ← try first
  organizations/{org}/files/{file}:download                          ← fallback
  ```

  Without this fallback chain, half the runs in production silently
  fail to load the PDF. See
  [`kognitos-api-client/references/runs-api.md`](../../kognitos-api-client/references/runs-api.md)
  for the run shape and the Files API for the download endpoint.

  Reference adapter:

  ```ts
  export async function downloadKognitosFile(
    fileId: string,
    { org, workspace }: { org: string; workspace?: string | null },
  ): Promise<Response> {
    const auth = await getKognitosAuthHeaders();
    if (workspace) {
      const wsUrl =
        `${KOGNITOS_BASE}/organizations/${org}/workspaces/${workspace}` +
        `/files/${fileId}:download`;
      const wsRes = await fetch(wsUrl, { headers: auth });
      if (wsRes.ok) return wsRes;
      // Fall through to org-scoped only on 404; bubble other errors.
      if (wsRes.status !== 404) return wsRes;
    }
    const orgUrl = `${KOGNITOS_BASE}/organizations/${org}/files/${fileId}:download`;
    return fetch(orgUrl, { headers: auth });
  }
  ```

- **Run payload JSON:** a server route that returns the raw payload object
  (the same JSON used to build `KognitosRun`, but unmapped). Log a single
  one-line diagnostic on every fetch:

  ```
  payloadIsObject, hasIdpExtractionResults, fieldsListItemsLength,
  extractedFieldItemsCount, normalizedHighlightsCount
  ```

  When Kognitos renames an `element_type` (it has happened), this log is
  the fastest signal — `extractedFieldItemsCount` will go to zero while
  `fieldsListItemsLength` stays positive.

- **Cancellation:** wrap the payload fetch in an `AbortController` and
  call `controller.abort()` when the dialog closes OR when `runId`
  changes mid-flight. Optionally abort the PDF fetch the same way. See
  "Render Lifecycle and Reset → Aborting In-flight Requests".

The viewer fetches both URLs once on mount, keyed by `runId` so changing
the row resets the in-flight requests cleanly. Mount with `key={runId}`
on the dialog as defense-in-depth (see "Reset Across Runs").

## Embedding the Viewer in a Chat Surface

When an operator clicks a document attachment that the agent surfaced
inline in chat, the click must mount the same in-app dialog the dashboard
uses — not an OS-level browser popup window. Browser popups defeat the
spotlight chrome, lose IDP overlays entirely, and frequently get blocked.

The right shape is a small per-attachment policy at the click site that
routes to one of three open modes:

| Open mode | Trigger condition | Surface | Capabilities |
|---|---|---|---|
| Rich PDF viewer | PDF mime AND non-null `runId` | In-app `Dialog` mounting `<InvoicePdfHighlightViewer />` | Bounding boxes, confidence panel, zoom, page nav, download |
| In-app image dialog | image mime AND any `href` | In-app `Dialog` showing `<img>` `object-contain` on a dark surround | Same chrome as the PDF dialog; scroll/zoom by browser default |
| Browser popup (last resort) | Neither of the above | `window.open(href, "_blank", DOC_POPUP_FEATURES)` | None of the rich UI; only when nothing else applies |

### MIME Sniffing

Agents frequently surface attachments with no `mimeType` and a generic
filename. The URL almost always still ends in `.pdf` / `.png` / etc.
Sniff both:

```ts
/**
 * Infer a MIME type from a filename / label or, failing that, the file
 * URL path. Sniffing both keeps PDFs out of the popup-window fallback
 * when the agent only gives us a file id (no extension on the label).
 */
export function inferMimeFromName(
  name: string | null | undefined,
  url?: string | null,
): string | null {
  const sources: string[] = [];
  if (name) sources.push(name);
  if (url) {
    const path = url.split(/[?#]/, 1)[0]; // strip query/hash
    if (path) sources.push(path);
  }
  for (const s of sources) {
    const m = s.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!m) continue;
    switch (m[1]) {
      case "pdf": return "application/pdf";
      case "png": return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "gif": return "image/gif";
      case "webp": return "image/webp";
      case "svg": return "image/svg+xml";
      default: continue;
    }
  }
  return null;
}
```

### Discriminated-Union Open Callback

Use one open callback that accepts a discriminated union — chat-tree
intermediaries don't need to learn about new variants:

```ts
type ChatPdfViewerOpen = { pdfUrl: string; runId: string; label: string };
type ChatImagePreviewOpen = { url: string; label: string; mimeType?: string | null };

export type ChatDocumentViewerOpen =
  | ({ kind: "pdf" } & ChatPdfViewerOpen)
  | ({ kind: "image" } & ChatImagePreviewOpen);

// Page-level setter routes to the right state, so the chat tree only
// needs to thread one prop.
const handleOpenAttachment = useCallback((args: ChatDocumentViewerOpen) => {
  if (args.kind === "pdf") {
    const { pdfUrl, runId, label } = args;
    setDocumentViewer({ pdfUrl, runId, label });
    return;
  }
  const { url, label, mimeType } = args;
  setImagePreview({ url, label, mimeType: mimeType ?? null });
}, []);
```

### Per-Attachment Click Handler

```tsx
function ChatAttachmentCard({
  data,           // ChatDocumentPreviewData from the reducer
  runId,          // null when the chat exception has no run
  onOpenDocumentViewer,
}: Props) {
  const display = data.label || "Attached document";
  const href = data.url
    ? data.url
    : data.fileId
      ? `/api/kognitos/files/${encodeURIComponent(data.fileId)}`
      : null;
  const effectiveMime = data.mimeType ?? inferMimeFromName(data.label, href);

  const isPdf = effectiveMime === "application/pdf";
  const isImage = !!effectiveMime && effectiveMime.startsWith("image/");
  const canOpenInViewer = !!href && isPdf && !!runId;
  const canOpenInImageDialog = !!href && isImage;

  const handleOpen = useCallback(() => {
    if (!href) return;
    if (canOpenInViewer && runId) {
      onOpenDocumentViewer({ kind: "pdf", pdfUrl: href, runId, label: display });
      return;
    }
    if (canOpenInImageDialog) {
      onOpenDocumentViewer({
        kind: "image", url: href, label: display, mimeType: effectiveMime,
      });
      return;
    }
    // Last-resort fallback. Sized popup with restricted chrome,
    // graceful-degrading to a plain new tab when popups are blocked.
    const win = window.open(href, "_blank", DOC_POPUP_FEATURES);
    if (!win) window.open(href, "_blank", "noopener,noreferrer");
  }, [canOpenInImageDialog, canOpenInViewer, display, effectiveMime, href, onOpenDocumentViewer, runId]);

  // …render a button with handleOpen, plus a small "Viewer" / "Preview"
  // affordance pill so users know what kind of surface they'll get.
}

const DOC_POPUP_FEATURES =
  "popup=yes,width=1000,height=800,resizable=yes,scrollbars=yes,toolbar=no,menubar=no";
```

### Image Dialog

The image dialog reuses the same dark-surround chrome as the PDF viewer
so attachment type doesn't introduce a chrome jump:

```tsx
function ChatImagePreviewDialog({ data, onClose }: {
  data: ChatImagePreviewOpen | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={data != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        centerFlex
        showCloseButton
        className="flex h-[min(82.8vh,828px)] w-[min(88.2vw,82.8rem)] max-w-[min(88.2vw,82.8rem)] flex-col gap-0 overflow-hidden border border-white/[0.08] bg-zinc-900 p-0 text-zinc-100 shadow-xl shadow-black/20"
      >
        <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-900 px-4 py-2 text-left">
          <DialogTitle className="text-base font-medium text-zinc-50">
            {data?.label ?? "Image preview"}
          </DialogTitle>
        </DialogHeader>
        {data ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#323234] p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.url}
              alt={data.label}
              className="block max-h-full max-w-full select-none object-contain"
              loading="eager"
              draggable={false}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

### Empty IDP State Inside the Viewer

Chat-launched runs frequently have no IDP output (e.g. agent attached a
PDF without running it through `book-idp`). The viewer must render the
PDF but tell the operator why the bounding-box layer is empty — otherwise
the chrome looks "broken".

```tsx
{!payloadLoading && !payloadError && parsedHighlights.length === 0 ? (
  <div
    role="status"
    aria-live="polite"
    className="shrink-0 border-b border-white/[0.06] bg-zinc-900/80 px-4 py-2"
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
) : null}
```

Track an explicit `payloadLoading` state alongside `payloadError` so the
banner only appears once the fetch has truly settled — flashing on every
load is worse than silent.

### Dialog Title Parity

All entry points — dashboard table cell, chat attachment, expert queue —
should display the document's filename in the dialog title, not a generic
label like "Document Processing". This keeps cross-surface affordances
matching the surface the operator just left.

```tsx
<DialogTitle>
  {invoiceViewer?.label ?? "Document Processing"}
</DialogTitle>
```

### Inline Preview is Optional

Embedding a document preview in chat is one of several entry points,
not a required one. Apps that don't expose chat document attachments
can skip this entire section — the dashboard table is the canonical
entry point, and the dialog mounts the same way regardless of trigger.

What is **not** optional, even when chat embedding is in scope:

- The dialog itself, mounted with `key={runId}`, with the same chrome
  and toolbar as the dashboard entry.
- Workspace-then-org Files API fallback in the download adapter, since
  chat-attached files are frequently workspace-scoped.
- Dialog title parity (the filename, not a generic label).

If the app surfaces inline previews in additional places (expert queue
row, audit-log inspector, anywhere else), each entry point routes
through the same `handleOpenAttachment` shape and the same dialog
component. There is exactly one viewer per app — entry points
multiply, the renderer does not.

## State Coverage

Every viewer must handle the states below explicitly. Silent
fall-through is the failure mode that "the viewer hangs" reports
typically describe — a state was reached and no UI was wired for it.

| State | Trigger | Required UI | Notes |
|---|---|---|---|
| `idle` | Dialog mounted, fetches not yet kicked off | Spinner or skeleton in workspace, empty toolbar/panel chrome | First frame after mount; lasts ≤ one effect cycle. |
| `pdf-loading` | `pdfjs.getDocument()` promise in flight | "Loading PDF…" overlay in workspace, toolbar disabled | Show after `idle`, before `PDFDocumentProxy` resolves. |
| `pdf-error` | PDF fetch threw or `getDocument` rejected | Error banner in workspace with `Retry` action; toolbar disabled; right panel still loads independently | Distinguish 404 (download adapter URL) from network error in the message. |
| `payload-loading` | Run-payload fetch in flight | Skeleton rows in right panel, page rail (if any) shows page count but no field-count badges | Independent of PDF state — the two fetches race in parallel. |
| `payload-error` | Run-payload fetch threw | Error banner inside right panel ("Could not load extracted fields"), document still rendered | Do NOT block the document on payload errors. |
| `payload-empty` | Payload settled with zero highlights | The "no extracted fields for this run" banner from "IDP Empty State"; right panel hidden or shows empty-state | Different message from `payload-error`. |
| `ready` | Both PDF and payload settled, fields > 0 | Document, overlays, toolbar, right panel all interactive | The default steady state. |
| `rendering-page` | `activePage` change, `page.render()` in flight | "Rendering…" overlay (lightweight) on the active page surface only; rail and panel stay interactive | Common — a page change between two `ready` states. |
| `render-cancelled` | Previous `RenderTask.cancel()` is awaiting cleanup before re-render | No UI change required; eat the `RenderingCancelledException` silently | See "Render-task Cancellation". |
| `highlights-off` | Operator toggled the highlight overlay off | Toolbar toggle pressed, dim layer hidden, bbox buttons hidden, panel rows still clickable | Click on any panel row re-enables — see "Highlight Visibility Coordination". |
| `panel-collapsed` | Operator collapsed the right panel | Workspace claims the freed width up to the locked fit cap (does not enlarge the document) | See "Document Positioning". |
| `closing` | Dialog closed mid-flight | All `AbortController`s aborted, `RenderTask`s cancelled, `pendingScrollRef` cleared, `highlightsOn` reset | See "Aborting In-flight Requests" and "Reset Across Runs". |

A small state-machine ref or `useReducer` is fine here — the explicit
goal is that no production state is reached without a UI transition,
not to mandate XState. If the implementation uses ad-hoc booleans
(`isLoading`, `hasError`), audit them against this table at review
time.

## App Review Questions

- If Kognitos adds a new element-type alias tomorrow, is there exactly
  one place in the parser to add it?
- Does the payload-fetch endpoint log `extractedFieldItemsCount` so a
  silent regression is visible at the next on-call check?
- Does toggling the right panel reflow the document, or does the fit cap
  stay locked?
- Does activating a panel row both jump the document to the field's page
  and scroll the row into view inside the panel?
- Are canvas, dim mask, and overlay layers driven by the same `layout`
  object, so they stay pixel-aligned across zoom and resize?
- Does the toolbar's `pointer-events-none` container leave the document
  clickable beneath it, with the pill itself re-enabling pointer events?
- When the parser yields zero highlights, does the UI render an explicit
  empty-state message (banner, not a small text strip) instead of a
  blank overlay?
- Does the PDF.js worker load from a same-origin URL pinned to the app's
  `pdfjs-dist` version, copied during install or build (no CDN)?
- Does the PDF download path try the workspace-scoped Files endpoint
  before falling back to org-scoped?
- Does the canvas mount as soon as the `PDFDocumentProxy` resolves, or
  does it wait on layout values that are themselves derived from
  `page.render()`?
- Does the viewer set the initial page to `min(field.pageNumber)` instead
  of always `1`?
- Are the SVG mask ids generated via `useId()` and sanitized for SVG, so
  two open dialogs (or hydration) don't share a `url(#…)` reference?
- Does clicking a panel row, confidence meter, or bounding box re-enable
  highlights when they're toggled off?
- Does the value chip in the right panel resolve nested dictionaries,
  lists, and decimal-bit numbers without ever falling back to
  `JSON.stringify`?
- Does the dialog use `key={runId}` (or equivalent) so refs and state
  reset when switching runs?
- Are in-flight payload requests aborted via `AbortController` on dialog
  close and `runId` change?
- For non-normalized bboxes, is the Y-axis flip decision made per page by
  overlap scoring, not by a global assumption?
- For chat-surfaced attachments: do PDFs route to the rich viewer when a
  `runId` is present, do images route to an in-app modal, and is the
  OS-level browser popup the last-resort fallback (not the default)?
- For chat-surfaced attachments: does MIME sniffing cover both the
  filename AND the URL path, so an extensionless label with a `.pdf`
  URL still hits the rich viewer?
