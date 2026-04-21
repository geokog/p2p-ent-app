/**
 * Derives COA / QTY / VAL (and optional DOC / PAY) checks from nested Kognitos
 * automation output: deep *_ok flags, IDP extracted_field rows, and free-text
 * mismatch phrases — so dashboard tables match “pending on mismatch” intent.
 */

type Dim = "docOk" | "qtyOk" | "valOk" | "coaOk" | "payOk";

export type ValidationChecks = Record<Dim, boolean>;

function runStateObject(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const st = payload.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) return null;
  return st as Record<string, unknown>;
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
