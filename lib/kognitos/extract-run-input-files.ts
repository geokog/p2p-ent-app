/**
 * Extract file references from raw Kognitos run JSON (`kognitos_runs.payload`).
 * Does not use `normalizeUserInputs` — file-shaped values must be read from structured objects.
 */

export type ExtractedFileRef = {
  inputKey: string;
  /** Path/query param for organizations/.../files/{file}:download */
  remote: string | null;
  /** Present when the API inlined bytes (prefer persisting remote when available). */
  inlineFileName: string | null;
};

function getRecord(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  return obj as Record<string, unknown>;
}

function fileValueFromCommonV1(
  val: Record<string, unknown>,
): { remote?: string; inline?: Record<string, unknown> } | null {
  const file = val.file;
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const fv = file as Record<string, unknown>;
  const remote = typeof fv.remote === "string" ? fv.remote.trim() : undefined;
  const inline =
    fv.inline && typeof fv.inline === "object" && !Array.isArray(fv.inline)
      ? (fv.inline as Record<string, unknown>)
      : undefined;
  if (!remote && !inline) return null;
  return { remote, inline };
}

function inlineName(inline: Record<string, unknown>): string | null {
  const a = inline.file_name;
  const b = inline.fileName;
  const c = inline.filename;
  const n =
    (typeof a === "string" ? a : null) ||
    (typeof b === "string" ? b : null) ||
    (typeof c === "string" ? c : null);
  const t = n?.trim();
  return t || null;
}

function extractFromInputValue(
  inputKey: string,
  raw: unknown,
  out: ExtractedFileRef[],
): void {
  const val = getRecord(raw);
  if (!val) return;

  let fv = fileValueFromCommonV1(val);
  if (!fv && val.file && typeof val.file === "object" && !Array.isArray(val.file)) {
    fv = fileValueFromCommonV1({ file: val.file });
  }
  if (!fv) return;

  const remote = fv.remote && fv.remote.length > 0 ? fv.remote : null;
  const inlineFileName = fv.inline ? inlineName(fv.inline) : null;

  out.push({
    inputKey,
    remote,
    inlineFileName,
  });
}

function walkInputsMap(map: unknown, out: ExtractedFileRef[]): void {
  const rec = getRecord(map);
  if (!rec) return;
  for (const [key, v] of Object.entries(rec)) {
    extractFromInputValue(key, v, out);
  }
}

/**
 * Collect file references from user inputs and executable step inputs.
 * Prefer rows where `remote` is set for download via Kognitos Files API.
 */
export function extractFileRefsFromKognitosPayload(
  payload: Record<string, unknown>,
): ExtractedFileRef[] {
  const out: ExtractedFileRef[] = [];

  walkInputsMap(payload.userInputs ?? payload.user_inputs, out);

  const steps =
    payload.executableSteps ?? payload.executable_steps ?? payload.executableSteps;
  const srec = getRecord(steps);
  if (srec?.inputs) walkInputsMap(srec.inputs, out);

  return out;
}

/**
 * Normalize API `file.remote` to the `{file}` path segment for `:download`.
 * Handles full resource names and bare ids.
 */
export function normalizeKognitosFileIdForDownload(remote: string): string {
  const t = remote.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  const slashFiles = t.lastIndexOf("/files/");
  if (slashFiles >= 0) {
    return t.slice(slashFiles + "/files/".length).replace(/^\/+/, "");
  }
  return t;
}
