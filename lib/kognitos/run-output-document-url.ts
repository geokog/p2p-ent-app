import {
  extractFileRefsFromKognitosPayload,
  kognitosFileDownloadIdVariants,
} from "@/lib/kognitos/extract-run-input-files";
import {
  listInvoicePdfFileIdCandidatesFromRun,
  type RunInputFileRow,
} from "@/lib/kognitos/resolve-invoice-pdf-file-id";

export type RunOutputDocumentResolution =
  | { url: string; kind: "https_remote" }
  | { url: string; kind: "presigned_download" };

/**
 * Resolve a browser-openable URL for the run’s primary document using Kognitos APIs:
 * 1. GET Run (canonical automation run path) for fresh `userInputs` / file refs.
 * 2. If any `file.remote` is already `https`, use it.
 * 3. Otherwise POST `files/{file}:generateDownloadUrl` for invoice PDF candidates
 *    (same id ordering as invoice download, with id variants).
 */
export async function resolveRunOutputDocumentUrl(
  runId: string,
  automationExternalId: string | undefined,
  inputRows: RunInputFileRow[],
): Promise<RunOutputDocumentResolution> {
  // Dynamic import avoids Turbopack app-route chunks leaving named exports from
  // `client-core` undefined when this module is pulled in via API routes.
  const {
    getRunRaw,
    generateOrganizationFileDownloadUrl,
  } = await import("@/lib/kognitos/client-core");

  const raw = await getRunRaw(runId, automationExternalId);
  if (!raw || typeof raw !== "object") {
    throw new Error("run_not_found");
  }

  const refs = extractFileRefsFromKognitosPayload(raw);
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b999a8",
    },
    body: JSON.stringify({
      sessionId: "b999a8",
      runId: "pre-fix",
      hypothesisId: "H3",
      location: "run-output-document-url.ts:refs",
      message: "extracted file refs from run",
      data: {
        refCount: refs.length,
        remotes: refs.map((r) => ({
          key: (r.inputKey ?? "").slice(0, 40),
          remoteStart: (r.remote ?? "").slice(0, 48),
          isHttps: /^https?:\/\//i.test(r.remote ?? ""),
        })),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  for (const ref of refs) {
    const r = ref.remote?.trim();
    if (r && /^https?:\/\//i.test(r)) {
      return { url: r, kind: "https_remote" };
    }
  }

  const candidates = listInvoicePdfFileIdCandidatesFromRun(raw, inputRows);
  const variants: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const v of kognitosFileDownloadIdVariants(c)) {
      if (/^https?:\/\//i.test(v)) continue;
      if (!v || seen.has(v)) continue;
      seen.add(v);
      variants.push(v);
    }
  }

  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b999a8",
    },
    body: JSON.stringify({
      sessionId: "b999a8",
      runId: "pre-fix",
      hypothesisId: "H1",
      location: "run-output-document-url.ts:variants",
      message: "invoice file id variants to try",
      data: {
        inputRowCount: inputRows.length,
        inputMeta: inputRows.slice(0, 6).map((r) => ({
          key: (r.input_key ?? "").slice(0, 40),
          idLen: (r.kognitos_file_id ?? "").length,
          hasDd: (r.kognitos_file_id ?? "").includes("--"),
        })),
        candidateCount: candidates.length,
        variantCount: variants.length,
        variantMeta: variants.map((v, i) => ({
          i,
          len: v.length,
          hasDd: v.includes("--"),
          head: v.slice(0, 12),
        })),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  let lastErr = "no_file_candidates";
  for (let vi = 0; vi < variants.length; vi++) {
    const fileId = variants[vi]!;
    try {
      const url = await generateOrganizationFileDownloadUrl(fileId);
      return { url, kind: "presigned_download" };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "generateDownloadUrl_failed";
      // #region agent log
      fetch(
        "http://127.0.0.1:7804/ingest/2ccf0569-63ad-4f5f-a128-4a22a784bde3",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "b999a8",
          },
          body: JSON.stringify({
            sessionId: "b999a8",
            runId: "pre-fix",
            hypothesisId: "H1",
            location: "run-output-document-url.ts:generateDownloadUrl",
            message: "generateDownloadUrl attempt failed",
            data: {
              variantIndex: vi,
              fileIdLen: fileId.length,
              hasDd: fileId.includes("--"),
              hasPct: fileId.includes("%"),
              err: lastErr.slice(0, 500),
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
    }
  }

  throw new Error(lastErr);
}
