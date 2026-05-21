/**
 * Helpers for detecting Kognitos file resource references inside chat content.
 *
 * Mirrors `kognitos/bumblebee/src/shared/utils/file-utils.ts`
 * (`isFileResourceName`, `extractFileIdFromSource`, `getFileDisplayName`,
 * `getSourceDisplayName`) so we treat `<related_outputs source="…">` and
 * inline `organizations/…/files/{id}--name.pdf` paths the same way the
 * Kognitos-native UI does.
 */

/**
 * Looks like a file resource name — either contains a `files/` resource path
 * or ends with a small file extension. Descriptive labels like
 * `"SAP Goods Receipt"` or `"sow_document"` are NOT file resources.
 */
export function isFileResourceName(source: string): boolean {
  if (!source) return false;
  if (source.includes("files/")) return true;
  const lastSegment = source.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]{1,10}$/.test(lastSegment);
}

/**
 * Extract the file id from either a full resource path
 * (`organizations/{org}/files/{id}--name.pdf`) or a bare file id.
 */
export function extractFileIdFromSource(source: string): string {
  if (!source) return "";
  const filesIndex = source.lastIndexOf("files/");
  if (filesIndex !== -1) {
    return source.slice(filesIndex + "files/".length);
  }
  return source;
}

/**
 * Strip the leading `{fileId}--` prefix that Kognitos prepends to filenames.
 * Returns the raw value if no prefix is present.
 */
export function getFileDisplayName(fileName: string): string {
  if (!fileName) return "";
  const i = fileName.indexOf("--");
  if (i === -1) return fileName;
  return fileName.slice(i + 2);
}

/** Convenience: full path → human-readable filename. */
export function getSourceDisplayName(source: string): string {
  if (!source) return "";
  return getFileDisplayName(extractFileIdFromSource(source));
}

/** Best-effort MIME guess from a filename extension. */
export function guessMimeFromName(name: string): string | undefined {
  const m = name.match(/\.([A-Za-z0-9]{1,10})$/);
  if (!m) return undefined;
  switch (m[1].toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "txt":
    case "log":
      return "text/plain";
    case "html":
    case "htm":
      return "text/html";
    case "xml":
      return "application/xml";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return undefined;
  }
}

/**
 * Find the first inline `organizations/{org}/files/{id}…` path in plain text.
 * Used to surface file references the agent dropped into prose without an
 * explicit `<file>` / `<related_outputs source>` wrapper.
 */
const INLINE_ORG_FILE_RE =
  /organizations\/[A-Za-z0-9_\-]+\/(?:workspaces\/[A-Za-z0-9_\-]+\/)?files\/([A-Za-z0-9_\-]+(?:--[^\s)<>"']+)?)/;

export function findInlineFileResourcePath(content: string): {
  match: string;
  fileId: string;
} | null {
  const m = content.match(INLINE_ORG_FILE_RE);
  if (!m) return null;
  return { match: m[0], fileId: m[1] };
}
