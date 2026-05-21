import { NextResponse } from "next/server";

import { downloadOrganizationFile } from "@/lib/kognitos/client-core";
import { kognitosFileDownloadIdVariants } from "@/lib/kognitos/extract-run-input-files";
import { getFileDisplayName } from "@/lib/kognitos/file-resource";
import { isKognitosFileDownloadConfigured } from "@/lib/kognitos/resolve-invoice-pdf-file-id";

/** Large invoice/document PDFs may take a few seconds to upstream + buffer. */
export const maxDuration = 60;

const QUOTED_NAME_RE = /filename\*?=([^;]+)/i;

function dispositionFromUpstream(
  upstream: Response,
  fallbackName: string,
): string {
  // Kognitos's `:download` RPC returns `attachment; filename="…"`. Re-use the
  // upstream filename (incl. RFC 5987 `filename*=`) but always force `inline`
  // so browsers preview PDFs/images instead of saving them. Callers that want
  // a forced download pass `?download=1`, which is handled separately above.
  const cd = upstream.headers.get("content-disposition") ?? "";
  const filenamePart = cd.match(QUOTED_NAME_RE)?.[0];
  if (filenamePart) return `inline; ${filenamePart}`;
  const safe = fallbackName.replace(/"/g, "");
  return `inline; filename="${safe}"`;
}

/**
 * Proxy a Kognitos org-level file download to the browser. Used by the
 * exception chat to surface invoice PDFs (and other documents) that the
 * agent attaches via `<related_outputs source="organizations/.../files/...">`.
 *
 * Supports `?download=1` to force `attachment` content-disposition.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const fileId = decodeURIComponent(id ?? "").trim();
  if (!fileId) {
    return NextResponse.json({ error: "missing_file_id" }, { status: 400 });
  }
  if (!isKognitosFileDownloadConfigured()) {
    return NextResponse.json(
      { error: "kognitos_env_missing" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const forceDownload = url.searchParams.get("download") === "1";

  let lastError = "download_failed";
  let upstream404 = true;
  // Some Kognitos file ids embed `--filename.pdf`; the org-level :download RPC
  // wants just the resource id. Try the full value first, then the prefix.
  for (const candidate of kognitosFileDownloadIdVariants(fileId)) {
    try {
      const upstream = await downloadOrganizationFile(candidate);
      const buf = await upstream.arrayBuffer();
      if (buf.byteLength === 0) {
        upstream404 = false;
        lastError = "empty_response_body";
        continue;
      }
      const headers = new Headers();
      const ct = upstream.headers.get("content-type");
      headers.set("Content-Type", ct && ct.trim() ? ct : "application/octet-stream");
      const displayName = getFileDisplayName(fileId) || "document";
      const disposition = forceDownload
        ? `attachment; filename="${displayName.replace(/"/g, "")}"`
        : dispositionFromUpstream(upstream, displayName);
      headers.set("Content-Disposition", disposition);
      // Short-lived cache so the chat can re-render without refetching every
      // event tick, but short enough that file replacements are picked up.
      headers.set("Cache-Control", "private, max-age=120");
      return new NextResponse(buf, { status: 200, headers });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "download_failed";
      if (!/^Kognitos download 404\b/.test(lastError)) {
        upstream404 = false;
      }
    }
  }

  if (upstream404) {
    return NextResponse.json(
      {
        error: "file_not_found_upstream",
        detail: lastError.slice(0, 600),
        hint: "Kognitos has no org file for this id. Confirm the file still exists in Kognitos and that KOGNITOS_ORGANIZATION_ID/WORKSPACE_ID are correct.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}
