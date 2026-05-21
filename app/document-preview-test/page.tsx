"use client";

/**
 * Document-preview test bed page.
 *
 * Standalone surface for evaluating the new `<PdfPreviewDialog />` against a
 * Kognitos run. Accepts the run id either via a `?runId=` query parameter
 * (auto-opens) or via the input box on the page.
 */

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PdfPreviewDialog } from "@/components/doc-preview-test/PdfPreview";

export default function DocumentPreviewTestPage() {
  const [runIdInput, setRunIdInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Hydrate from `?runId=…` so the page is shareable. We deliberately defer
  // to a post-mount effect rather than a `useState` lazy initializer to
  // avoid an SSR hydration mismatch (server renders the empty state; the
  // URL is only readable on the client).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("runId")?.trim();
    if (!fromQuery) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL → state hydration; safe to ignore the cascading-render warning
    setRunIdInput(fromQuery);
    setActiveRunId(fromQuery);
    setOpen(true);
  }, []);

  const canSubmit = useMemo(() => runIdInput.trim().length > 0, [runIdInput]);

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Document preview test bed
        </h1>
        <p className="text-sm text-muted-foreground">
          Standalone harness for the new <code>PdfPreviewDialog</code>. Drop a
          Kognitos run id below to load its PDF + IDP extraction in the
          dialog. Pages with bounding boxes get highlighted; the right panel
          renders the extracted-field list with confidence bars.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = runIdInput.trim();
          if (!id) return;
          setActiveRunId(id);
          setOpen(true);
          // Reflect the loaded run in the URL so the page is shareable.
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("runId", id);
            window.history.replaceState({}, "", url.toString());
          }
        }}
        className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      >
        <div className="space-y-2">
          <Label htmlFor="runId">Kognitos run id</Label>
          <Input
            id="runId"
            value={runIdInput}
            onChange={(e) => setRunIdInput(e.target.value)}
            placeholder="e.g. run_abc123"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            The page calls <code>/api/kognitos/runs/&#123;runId&#125;/payload</code>{" "}
            for the IDP JSON and{" "}
            <code>/api/kognitos/runs/&#123;runId&#125;/invoice-pdf</code> for
            the PDF bytes.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!canSubmit}>
            Open preview
          </Button>
        </div>
      </form>

      {activeRunId ? (
        <section className="rounded-lg border bg-card p-4 text-sm">
          <div className="mb-1 font-medium">Active run</div>
          <code className="break-all text-muted-foreground">{activeRunId}</code>
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              disabled={open}
            >
              Re-open dialog
            </Button>
          </div>
        </section>
      ) : null}

      <PdfPreviewDialog
        open={open && !!activeRunId}
        runId={activeRunId}
        onOpenChange={setOpen}
        title={
          activeRunId
            ? `Document preview — ${activeRunId}`
            : "Document preview"
        }
      />
    </main>
  );
}
