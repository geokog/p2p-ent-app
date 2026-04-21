/**
 * Derives COA / QTY / VAL (and optional DOC / PAY) checks from nested Kognitos
 * automation output: deep *_ok flags, IDP extracted_field rows, and free-text
 * mismatch phrases — so dashboard tables match “pending on mismatch” intent.
 */

import {
  isMarkdownTableSeparatorRow,
  markdownReportTextFromOutputs,
  splitMarkdownTableCells,
} from "@/lib/kognitos/markdown-report-supplier-invoice";

type Dim = "docOk" | "qtyOk" | "valOk" | "coaOk" | "payOk";

export type ValidationChecks = Record<Dim, boolean>;

function runStateObject(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const st = payload.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) return null;
  return st as Record<string, unknown>;
}

/** Same merge as `getMergedOutputsForPaymentText` in `normalize-dashboard-run` (avoid import cycle). */
function mergedOutputsFromPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const completed = runStateObject(payload)?.completed as
    | Record<string, unknown>
    | undefined;
  const completedOut =
    completed?.outputs &&
    typeof completed.outputs === "object" &&
    !Array.isArray(completed.outputs)
      ? (completed.outputs as Record<string, unknown>)
      : {};
  const topOut =
    payload.outputs &&
    typeof payload.outputs === "object" &&
    !Array.isArray(payload.outputs)
      ? (payload.outputs as Record<string, unknown>)
      : {};
  return { ...topOut, ...completedOut };
}

function userInputsObject(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const ui = payload.userInputs ?? payload.user_inputs;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return {};
  return ui as Record<string, unknown>;
}

function stringFromJsonValue(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.stringValue === "string" && o.stringValue.trim()) {
    return o.stringValue.trim();
  }
  if (typeof o.string_value === "string" && o.string_value.trim()) {
    return o.string_value.trim();
  }
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  return undefined;
}

function parseBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/** Booleans, numeric 0/1, or PASS/FAIL-style strings (incl. wrapped protobuf scalars). */
function boolOrPassFailFromValue(v: unknown): boolean | undefined {
  const b = parseBool(v);
  if (b !== undefined) return b;
  const s = stringFromJsonValue(v);
  if (!s) return undefined;
  return passFailFromCell(s);
}

/** Interpret `payment_recommendation`-style text; `undefined` = no opinion. */
export function payOkFromRecommendationText(pr: string): boolean | undefined {
  const u = pr.toUpperCase();
  if (/NOT\s*APPROVED|\bREJECT|\bDENIED/i.test(u)) return false;
  if (/\bPENDING\b|\bHOLD\b|\bHELD\b|\bBLOCK\b|\bDEFER\b|\bESCALAT/i.test(u)) {
    if (!/APPROVED/i.test(u)) return false;
  }
  if (/APPROVED|RELEASE|PAID|CLEARED|SUCCESS/i.test(u)) return true;
  return undefined;
}

function tryFlattenProtobufDictionary(
  obj: Record<string, unknown>,
): Record<string, unknown> | null {
  const entries = obj.entries;
  if (!Array.isArray(entries)) return null;
  const out: Record<string, unknown> = {};
  for (const e of entries) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const ent = e as Record<string, unknown>;
    const keyText = stringFromJsonValue(ent.key);
    if (!keyText) continue;
    out[keyText] = ent.value;
  }
  return Object.keys(out).length ? out : null;
}

function firstTextFromValuesNode(valuesNode: unknown): string | undefined {
  if (!valuesNode || typeof valuesNode !== "object" || Array.isArray(valuesNode)) {
    return undefined;
  }
  const o = valuesNode as Record<string, unknown>;
  const list = (o.list as Record<string, unknown> | undefined)?.items ?? o.items;
  if (!Array.isArray(list)) return undefined;
  for (const item of list) {
    const t = stringFromJsonValue(item);
    if (t) return t;
  }
  return undefined;
}

/** PASS / FAIL style labels from extracted cells or booleans. */
function passFailFromCell(text: string): boolean | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const u = t.toUpperCase();
  if (/\b(FAIL|FAILED|FALSE|NO|MISMATCH|INVALID|MISSING|NOT\s+FOUND|ERROR|REJECT)\b/i.test(t)) {
    return false;
  }
  if (/\b(N\/A|NA|NONE|NOT\s+APPLICABLE)\b/i.test(u)) return false;
  if (/\b(PASS|PASSED|TRUE|YES|OK|SUCCESS|MATCH|VALID|ALIGNED|APPROVED)\b/i.test(t)) {
    return true;
  }
  return undefined;
}

function dimensionForExtractedFieldName(name: string): "coa" | "qty" | "val" | null {
  const n = name.toLowerCase();
  if (
    /\bcoa\b|coa_|certificate_of_analysis|certificate|analyte|purity_result|specification_result|coa_validation|coa_status|coa_match/.test(
      n,
    )
  ) {
    return "coa";
  }
  if (
    /quantity|qty|units?_?match|invoice_po_qty|po_qty|qty_match|quantity_match|qty_validation|line_qty|grn_qty/.test(
      n,
    )
  ) {
    return "qty";
  }
  if (
    /value_match|amount_match|price_match|po_invoice|invoice_po_amount|invoice_po_value|po_invoice_amount|total_amount_match|amount_validation|value_validation|net_amount_match|invoice_amount|po_amount/.test(
      n,
    )
  ) {
    return "val";
  }
  return null;
}

function outputsScanRoots(payload: Record<string, unknown>): unknown[] {
  const roots: unknown[] = [];
  const completed = runStateObject(payload)?.completed as
    | Record<string, unknown>
    | undefined;
  if (completed?.outputs && typeof completed.outputs === "object") {
    roots.push(completed.outputs);
  }
  const top = payload.outputs;
  if (top && typeof top === "object" && !Array.isArray(top)) roots.push(top);
  return roots;
}

type ProtoAcc = {
  coa: { pass: boolean; fail: boolean; seen: boolean };
  qty: { pass: boolean; fail: boolean; seen: boolean };
  val: { pass: boolean; fail: boolean; seen: boolean };
};

function emptyAcc(): ProtoAcc {
  return {
    coa: { pass: false, fail: false, seen: false },
    qty: { pass: false, fail: false, seen: false },
    val: { pass: false, fail: false, seen: false },
  };
}

function ingestProtoField(acc: ProtoAcc, fieldName: string, cell: string): void {
  const dim = dimensionForExtractedFieldName(fieldName);
  if (!dim) return;
  const slot = acc[dim];
  slot.seen = true;
  if (dim === "coa" && !cell.trim()) {
    slot.fail = true;
    return;
  }
  const pf = passFailFromCell(cell);
  if (pf === true) slot.pass = true;
  if (pf === false) slot.fail = true;
}

function walkExtractedFields(node: unknown, depth: number, acc: ProtoAcc): void {
  if (depth > 22 || node == null) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) walkExtractedFields(x, depth + 1, acc);
    return;
  }
  const o = node as Record<string, unknown>;
  const flat = tryFlattenProtobufDictionary(o);
  if (flat) {
    const fieldName = stringFromJsonValue(flat.name);
    const extracted =
      stringFromJsonValue(flat.element_type)?.toLowerCase() === "extracted_field" ||
      flat.values != null;
    if (fieldName && extracted) {
      const cell = firstTextFromValuesNode(flat.values) ?? "";
      ingestProtoField(acc, fieldName, cell);
    }
  }
  for (const v of Object.values(o)) walkExtractedFields(v, depth + 1, acc);
}

function collectStringLeaves(node: unknown, depth: number, out: string[]): void {
  if (depth > 20 || node == null) return;
  if (typeof node === "string") {
    if (node.length > 2 && node.length < 4000) out.push(node);
    return;
  }
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectStringLeaves(x, depth + 1, out);
    return;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    collectStringLeaves(v, depth + 1, out);
  }
}

function textMismatchSignals(strings: string[]): {
  coaFail: boolean;
  qtyFail: boolean;
  valFail: boolean;
} {
  let coaFail = false;
  let qtyFail = false;
  let valFail = false;
  for (const s of strings) {
    const t = s;
    if (
      /(coa|certificate\s+of\s+analysis).{0,120}(missing|not\s+found|invalid|fail|mismatch|error|reject)/i.test(
        t,
      ) ||
      /(missing|no)\s+coa\b/i.test(t)
    ) {
      coaFail = true;
    }
    if (
      /(quantity|qty|units?).{0,80}(mismatch|does\s+not\s+match|not\s+match|fail)/i.test(t) ||
      /\bqty\s*mismatch\b/i.test(t)
    ) {
      qtyFail = true;
    }
    if (
      /(invoice|po).{0,60}(amount|value|total|price).{0,40}(mismatch|does\s+not\s+match|not\s+match|fail|discrep)/i.test(
        t,
      ) ||
      /\bvalue\s*mismatch\b/i.test(t) ||
      /\bamount\s*mismatch\b/i.test(t)
    ) {
      valFail = true;
    }
  }
  return { coaFail, qtyFail, valFail };
}

function finalizeProtoDim(
  acc: { pass: boolean; fail: boolean; seen: boolean },
): boolean | undefined {
  if (acc.fail) return false;
  if (acc.pass && !acc.fail) return true;
  return undefined;
}

/** Maps normalized JSON keys (underscores stripped) to validation dimensions. */
function explicitOkSlotFromNormKey(norm: string): Dim | null {
  if (norm === "docok") return "docOk";
  if (norm === "qtyok") return "qtyOk";
  if (norm === "valok") return "valOk";
  if (norm === "payok") return "payOk";
  if (norm === "coaok") return "coaOk";
  // Automations often emit dedicated COA pass/fail keys (not only `coa_ok`).
  if (
    norm.startsWith("coa") &&
    /(ok|status|result|pass|valid|outcome|check|success|failed|fail|match|validation)/.test(
      norm,
    )
  ) {
    return "coaOk";
  }
  return null;
}

/** Deep *_ok / *_OK keys anywhere under payload (automation often nests them). */
export function readDeepExplicitOkFlags(
  payload: Record<string, unknown>,
): Partial<ValidationChecks> {
  const acc: Partial<Record<Dim, "t" | "f">> = {};

  const apply = (key: string, v: unknown) => {
    const norm = key.replace(/_/g, "").toLowerCase();
    const slot = explicitOkSlotFromNormKey(norm);
    if (!slot) return;
    const verdict = boolOrPassFailFromValue(v);
    if (verdict === undefined) return;
    if (verdict === false) acc[slot] = "f";
    else if (verdict === true && acc[slot] !== "f") acc[slot] = "t";
  };

  const visit = (node: unknown, depth: number) => {
    if (depth > 22 || node == null) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      apply(k, v);
      if (v != null && typeof v === "object") visit(v, depth + 1);
    }
  };

  visit(payload, 0);
  const out: Partial<ValidationChecks> = {};
  (["docOk", "qtyOk", "valOk", "coaOk", "payOk"] as const).forEach((d) => {
    const s = acc[d];
    if (s === "f") out[d] = false;
    else if (s === "t") out[d] = true;
  });
  return out;
}

/** Shallow userInputs + top-level completed.outputs only (legacy). */
export function readShallowExplicitOkFlags(
  payload: Record<string, unknown>,
): Partial<ValidationChecks> {
  const ui = userInputsObject(payload);
  const out = runStateObject(payload)?.completed as
    | Record<string, unknown>
    | undefined;
  const outputs = out?.outputs as Record<string, unknown> | undefined;
  const bag = { ...ui, ...((outputs ?? {}) as Record<string, unknown>) };
  const pick = (snake: string, camel: string): boolean | undefined => {
    const v = bag[snake] ?? bag[camel];
    return parseBool(v);
  };
  function firstBoolOrPassFail(keys: string[]): boolean | undefined {
    for (const k of keys) {
      const v = bag[k];
      const r = boolOrPassFailFromValue(v);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const partial: Partial<ValidationChecks> = {};
  const doc = pick("doc_ok", "docOk");
  const qty = pick("qty_ok", "qtyOk");
  const val = pick("val_ok", "valOk");
  const coa = firstBoolOrPassFail([
    "coa_ok",
    "coaOk",
    "coa_status",
    "coaStatus",
    "coa_result",
    "coaResult",
    "coa_pass",
    "coaPass",
    "coa_passed",
    "coaPassed",
    "coa_validation",
    "coaValidation",
    "coa_outcome",
    "coaOutcome",
  ]);
  const pay = pick("pay_ok", "payOk");
  if (doc !== undefined) partial.docOk = doc;
  if (qty !== undefined) partial.qtyOk = qty;
  if (val !== undefined) partial.valOk = val;
  if (coa !== undefined) partial.coaOk = coa;
  if (pay !== undefined) partial.payOk = pay;
  return partial;
}

/**
 * Infer COA / QTY / VAL from automation output (IDP rows + mismatch text).
 * Returns partial overrides; absent keys mean “no signal”.
 */
export function inferCoaQtyValFromAutomationOutput(
  payload: Record<string, unknown>,
): Partial<Pick<ValidationChecks, "coaOk" | "qtyOk" | "valOk">> {
  const roots = outputsScanRoots(payload);
  if (roots.length === 0) return {};

  const proto = emptyAcc();
  const strings: string[] = [];
  for (const r of roots) {
    walkExtractedFields(r, 0, proto);
    collectStringLeaves(r, 0, strings);
  }

  const text = textMismatchSignals(strings);

  const out: Partial<Pick<ValidationChecks, "coaOk" | "qtyOk" | "valOk">> = {};

  const coaProto = finalizeProtoDim(proto.coa);
  if (text.coaFail) out.coaOk = false;
  else if (coaProto !== undefined) out.coaOk = coaProto;

  const qtyProto = finalizeProtoDim(proto.qty);
  if (text.qtyFail) out.qtyOk = false;
  else if (qtyProto !== undefined) out.qtyOk = qtyProto;

  const valProto = finalizeProtoDim(proto.val);
  if (text.valFail) out.valOk = false;
  else if (valProto !== undefined) out.valOk = valProto;

  return out;
}

/** `Validation Results`, `Validation Result`, `validation_results`, etc. */
const VALIDATION_RESULTS_KEY_RE = /^validation[\s_]*results?$/i;

const MAX_VALUE_MATCH_SCAN_NODES = 14_000;

function normKeyLabel(key: string): string {
  return key.replace(/[\s_-]+/g, "").toLowerCase();
}

/**
 * Kognitos payloads often store table cells as protobuf-shaped objects, not plain
 * strings. Walk a few common shapes so Expected/Actual are comparable.
 */
function coerceCellToComparableString(v: unknown, depth = 0): string | undefined {
  if (depth > 10 || v == null) return undefined;
  const flat = stringFromJsonValue(v);
  if (flat && flat.trim()) return flat.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  for (const k of [
    "stringValue",
    "string_value",
    "text",
    "value",
    "amount",
    "display",
    "formatted",
    "number",
    "raw",
    "label",
    "title",
  ]) {
    const inner = coerceCellToComparableString(o[k], depth + 1);
    if (inner) return inner;
  }
  const sc = o.scalar;
  if (typeof sc === "number" && Number.isFinite(sc)) return String(sc);
  return undefined;
}

/** Case- / separator-insensitive lookup on a row object (flat or nested cell values). */
function rowStringField(
  row: Record<string, unknown>,
  ...labels: string[]
): string | undefined {
  const want = new Set(labels.map(normKeyLabel));
  for (const [k, v] of Object.entries(row)) {
    if (!want.has(normKeyLabel(k))) continue;
    const s = coerceCellToComparableString(v);
    if (s) return s;
  }
  return undefined;
}

function rowCheckNameNormalized(row: Record<string, unknown>): string {
  const name = rowStringField(
    row,
    "Check Name",
    "check_name",
    "checkName",
    "CheckName",
  );
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function rowIsValueMatchCheck(row: Record<string, unknown>): boolean {
  const n = rowCheckNameNormalized(row);
  if (!n) return false;
  if (n === "value match") return true;
  return /\bvalue\s*match\b/.test(n);
}

function rowIsQuantityMatchCheck(row: Record<string, unknown>): boolean {
  const n = rowCheckNameNormalized(row);
  if (!n) return false;
  if (rowIsValueMatchCheck(row)) return false;
  if (n === "quantity match" || n === "qty match") return true;
  if (/\bquantity\s*match\b/.test(n)) return true;
  if (/\bqty\s*match\b/.test(n)) return true;
  if (/\bunit[s]?\s*match\b/.test(n)) return true;
  if (/\bquantity\s*&\s*unit\s*match\b/.test(n)) return true;
  if (/\bquantity\s+and\s+unit\s+match\b/.test(n)) return true;
  if (/\bquantity\s+and\s+unit\s+validation\b/.test(n)) return true;
  return false;
}

function rowIsCoaMatchCheck(row: Record<string, unknown>): boolean {
  const n = rowCheckNameNormalized(row);
  if (!n) return false;
  if (/\bcoa\s*match\b/.test(n)) return true;
  if (/\bcoa\s*validation\b/.test(n)) return true;
  if (/\bcertificate\s+of\s+analysis\s+match\b/.test(n)) return true;
  if (
    n.includes("certificate of analysis") &&
    /\b(match|validation|check|verify)\b/.test(n)
  ) {
    return true;
  }
  return false;
}

function rowIsDocumentMatchCheck(row: Record<string, unknown>): boolean {
  const n = rowCheckNameNormalized(row);
  if (!n) return false;
  if (rowIsValueMatchCheck(row)) return false;
  if (/\bdocument\s*match\b/.test(n)) return true;
  if (/\bdocument\s*validation\b/.test(n)) return true;
  if (/\binvoice\s*document\s*match\b/.test(n)) return true;
  if (/\bpo\s*document\s*match\b/.test(n)) return true;
  if (/\bdoc\s*match\b/.test(n)) return true;
  if (
    /\bsupplier\s*invoice\b/.test(n) &&
    /\b(match|validation|id|number|document)\b/.test(n)
  ) {
    return true;
  }
  return false;
}

function normalizeComparableScalar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ");
}

/** Compare currency / numeric-ish strings so `114,800` ≈ `114800` ≈ `$114800.00`. */
function expectedActualSemanticallyEqual(a: string, b: string): boolean {
  const na = normalizeComparableScalar(a);
  const nb = normalizeComparableScalar(b);
  if (na === nb) return true;
  const digitsA = na.replace(/[^\d.-]/g, "");
  const digitsB = nb.replace(/[^\d.-]/g, "");
  if (!digitsA || !digitsB) return false;
  const fa = parseFloat(digitsA);
  const fb = parseFloat(digitsB);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return false;
  return Math.abs(fa - fb) < 1e-6;
}

function valueMatchRowIndicatesFail(row: Record<string, unknown>): boolean {
  const statusRaw = rowStringField(row, "Status", "status");
  const statusVerdict =
    statusRaw !== undefined
      ? (boolOrPassFailFromValue(statusRaw) ??
        passFailFromCell(statusRaw))
      : undefined;

  const expected = rowStringField(row, "Expected", "expected") ?? "";
  const actual = rowStringField(row, "Actual", "actual") ?? "";
  const valueMismatch =
    expected.trim().length > 0 ||
    actual.trim().length > 0
      ? !expectedActualSemanticallyEqual(expected, actual)
      : false;

  if (statusVerdict === false) return true;
  if (statusVerdict === true) return valueMismatch;
  return valueMismatch;
}

function parseValidationResultsTableRows(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length < 2) return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const bag = parsed as Record<string, unknown>;
        const inner = bag.rows ?? bag.items ?? bag.data ?? bag.results;
        if (Array.isArray(inner)) return inner;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const bag = v as Record<string, unknown>;
    const inner = bag.rows ?? bag.items ?? bag.data ?? bag.results;
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

function collectValidationResultsArrays(
  node: unknown,
  depth: number,
  out: unknown[][],
): void {
  if (depth > 28 || node == null) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const el of node) collectValidationResultsArrays(el, depth + 1, out);
    return;
  }
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (VALIDATION_RESULTS_KEY_RE.test(k.trim())) {
      const rows = parseValidationResultsTableRows(v);
      if (rows) out.push(rows);
    }
    collectValidationResultsArrays(v, depth + 1, out);
  }
}

/**
 * Some automations nest the same table rows without a parent key named
 * "Validation Results". Scan modest-sized object arrays anywhere in the payload.
 */
function scanArraysForValueMatchFailure(
  node: unknown,
  depth: number,
  budget: { n: number },
): boolean {
  if (budget.n++ > MAX_VALUE_MATCH_SCAN_NODES || depth > 30 || node == null) {
    return false;
  }
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.length <= 400 &&
      node.every((x) => x != null && typeof x === "object" && !Array.isArray(x))
    ) {
      for (const item of node) {
        const row = item as Record<string, unknown>;
        if (rowIsValueMatchCheck(row) && valueMatchRowIndicatesFail(row)) {
          return true;
        }
      }
    }
    for (const el of node) {
      if (scanArraysForValueMatchFailure(el, depth + 1, budget)) return true;
    }
    return false;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      if (scanArraysForValueMatchFailure(v, depth + 1, budget)) return true;
    }
  }
  return false;
}

type MdValidationColMap = {
  checkName: number;
  expected?: number;
  actual?: number;
  status?: number;
};

function normalizeMarkdownTableCell(c: string): string {
  return c.replace(/\*+/g, "").trim();
}

function tryParseValidationResultsMarkdownHeader(
  cells: string[],
): MdValidationColMap | null {
  if (cells.length < 2) return null;
  let checkIdx = -1;
  let expectedIdx = -1;
  let actualIdx = -1;
  let statusIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const raw = normalizeMarkdownTableCell(cells[i] ?? "");
    const c = raw.toLowerCase();
    if (
      checkIdx < 0 &&
      (c === "check name" ||
        c === "check_name" ||
        c === "checkname" ||
        /^check\s*name$/i.test(raw))
    ) {
      checkIdx = i;
    }
    if (expectedIdx < 0 && (c === "expected" || /^expected(\s+value)?$/i.test(raw))) {
      expectedIdx = i;
    }
    if (actualIdx < 0 && (c === "actual" || /^actual(\s+value)?$/i.test(raw))) {
      actualIdx = i;
    }
    if (statusIdx < 0 && (c === "status" || /^status$/i.test(raw))) {
      statusIdx = i;
    }
  }
  if (checkIdx < 0) return null;
  if (expectedIdx < 0 && actualIdx < 0) return null;
  const out: MdValidationColMap = { checkName: checkIdx };
  if (expectedIdx >= 0) out.expected = expectedIdx;
  if (actualIdx >= 0) out.actual = actualIdx;
  if (statusIdx >= 0) out.status = statusIdx;
  return out;
}

function syntheticRowFromMarkdownPipeCells(
  cells: string[],
  col: MdValidationColMap,
): Record<string, unknown> {
  const get = (i?: number) =>
    i !== undefined && i >= 0 && i < cells.length
      ? normalizeMarkdownTableCell(cells[i]!)
      : "";
  return {
    "Check Name": get(col.checkName),
    Expected: col.expected !== undefined ? get(col.expected) : "",
    Actual: col.actual !== undefined ? get(col.actual) : "",
    Status: col.status !== undefined ? get(col.status) : "",
  };
}

/**
 * SAP-style `markdown_report.text` often carries **Validation Results** as a pipe
 * table (not JSON). Parse header row + body rows the same way as structured rows.
 */
function eachMarkdownValidationResultsRow(
  markdown: string,
  onRow: (row: Record<string, unknown>) => boolean,
): boolean {
  if (!markdown || typeof markdown !== "string") return false;
  let colMap: MdValidationColMap | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const rawCells = splitMarkdownTableCells(line);
    if (!rawCells) {
      colMap = null;
      continue;
    }
    if (isMarkdownTableSeparatorRow(rawCells)) continue;
    if (rawCells.length < 2) continue;
    if (!colMap) {
      const next = tryParseValidationResultsMarkdownHeader(rawCells);
      if (next) colMap = next;
      continue;
    }
    const maybeNewHeader = tryParseValidationResultsMarkdownHeader(rawCells);
    if (maybeNewHeader) {
      colMap = maybeNewHeader;
      continue;
    }
    const rowObj = syntheticRowFromMarkdownPipeCells(rawCells, colMap);
    if (onRow(rowObj)) return true;
  }
  return false;
}

function valueMatchFailureFromMarkdownReportText(markdown: string): boolean {
  return eachMarkdownValidationResultsRow(markdown, (rowObj) => {
    return rowIsValueMatchCheck(rowObj) && valueMatchRowIndicatesFail(rowObj);
  });
}

function gatherMarkdownTextsForValidationScan(
  payload: Record<string, unknown>,
): string[] {
  const acc: string[] = [];
  const seen = new Set<string>();
  const push = (s?: string) => {
    if (!s || typeof s !== "string") return;
    const t = s.trim();
    if (t.length < 40) return;
    if (seen.has(t)) return;
    seen.add(t);
    acc.push(t);
  };

  push(markdownReportTextFromOutputs(mergedOutputsFromPayload(payload)));

  const budget = { n: 0 };
  const visit = (node: unknown, depth: number) => {
    if (budget.n++ > 12_000 || depth > 26) return;
    if (typeof node === "string") {
      if (
        node.length >= 80 &&
        /\|/.test(node) &&
        (/expected/i.test(node) || /actual/i.test(node)) &&
        (/check\s*name/i.test(node) ||
          /validation\s*results?/i.test(node) ||
          /\b(value|quantity|qty|coa|document|supplier\s*invoice|certificate\s+of\s+analysis)\b/i.test(
            node,
          ))
      ) {
        push(node);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    for (const v of Object.values(node as Record<string, unknown>)) {
      visit(v, depth + 1);
    }
  };
  visit(payload, 0);
  return acc;
}

/**
 * When payload JSON includes a **Validation Results** table with a **Value Match**
 * row where Status is Fail or Expected/Actual disagree, VAL must fail on the dashboard.
 */
export function validationResultsValueMatchIndicatesFailure(
  payload: Record<string, unknown>,
): boolean {
  for (const md of gatherMarkdownTextsForValidationScan(payload)) {
    if (valueMatchFailureFromMarkdownReportText(md)) return true;
  }

  const arrays: unknown[][] = [];
  collectValidationResultsArrays(payload, 0, arrays);
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (!rowIsValueMatchCheck(row)) continue;
      if (valueMatchRowIndicatesFail(row)) return true;
    }
  }
  const budget = { n: 0 };
  if (scanArraysForValueMatchFailure(payload, 0, budget)) return true;
  return false;
}

function scanArraysForFirstExpectedActualRow(
  node: unknown,
  depth: number,
  budget: { n: number },
  rowTest: (row: Record<string, unknown>) => boolean,
): { expected: string; actual: string } | null {
  if (budget.n++ > MAX_VALUE_MATCH_SCAN_NODES || depth > 30 || node == null) {
    return null;
  }
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.length <= 400 &&
      node.every((x) => x != null && typeof x === "object" && !Array.isArray(x))
    ) {
      for (const item of node) {
        const row = item as Record<string, unknown>;
        if (!rowTest(row)) continue;
        const expected = rowStringField(row, "Expected", "expected") ?? "";
        const actual = rowStringField(row, "Actual", "actual") ?? "";
        if (expected.trim() || actual.trim()) {
          return { expected: expected.trim(), actual: actual.trim() };
        }
      }
    }
    for (const el of node) {
      const hit = scanArraysForFirstExpectedActualRow(el, depth + 1, budget, rowTest);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      const hit = scanArraysForFirstExpectedActualRow(v, depth + 1, budget, rowTest);
      if (hit) return hit;
    }
  }
  return null;
}

function firstExpectedActualForRowTest(
  payload: Record<string, unknown>,
  rowTest: (row: Record<string, unknown>) => boolean,
): { expected: string; actual: string } | null {
  for (const md of gatherMarkdownTextsForValidationScan(payload)) {
    let found: { expected: string; actual: string } | null = null;
    eachMarkdownValidationResultsRow(md, (rowObj) => {
      if (!rowTest(rowObj)) return false;
      const expected = rowStringField(rowObj, "Expected", "expected") ?? "";
      const actual = rowStringField(rowObj, "Actual", "actual") ?? "";
      if (!expected.trim() && !actual.trim()) return false;
      found = { expected: expected.trim(), actual: actual.trim() };
      return true;
    });
    if (found) return found;
  }

  const arrays: unknown[][] = [];
  collectValidationResultsArrays(payload, 0, arrays);
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (!rowTest(row)) continue;
      const expected = rowStringField(row, "Expected", "expected") ?? "";
      const actual = rowStringField(row, "Actual", "actual") ?? "";
      if (expected.trim() || actual.trim()) {
        return { expected: expected.trim(), actual: actual.trim() };
      }
    }
  }

  const budget = { n: 0 };
  return scanArraysForFirstExpectedActualRow(payload, 0, budget, rowTest);
}

/**
 * Reads the **Value Match** row’s Expected / Actual strings from markdown reports
 * or structured validation tables in the run payload (same sources as VAL failure detection).
 */
export function valueMatchExpectedActualFromPayload(
  payload: Record<string, unknown>,
): { expected: string; actual: string } | null {
  return firstExpectedActualForRowTest(payload, rowIsValueMatchCheck);
}

/** Quantity / unit style checks in **Validation Results** (markdown or JSON). */
export function qtyMatchExpectedActualFromPayload(
  payload: Record<string, unknown>,
): { expected: string; actual: string } | null {
  return firstExpectedActualForRowTest(payload, rowIsQuantityMatchCheck);
}

/** COA style checks in **Validation Results** (markdown or JSON). */
export function coaMatchExpectedActualFromPayload(
  payload: Record<string, unknown>,
): { expected: string; actual: string } | null {
  return firstExpectedActualForRowTest(payload, rowIsCoaMatchCheck);
}

/** Document / supplier-invoice style checks in **Validation Results** (markdown or JSON). */
export function docMatchExpectedActualFromPayload(
  payload: Record<string, unknown>,
): { expected: string; actual: string } | null {
  return firstExpectedActualForRowTest(payload, rowIsDocumentMatchCheck);
}
