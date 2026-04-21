import { extractIdpProtobufHints } from "@/lib/kognitos/idp-protobuf-extracted";
import {
  deepMoneyHint,
  deepTitleHint,
  deepVendorHint,
  looksLikeOpaqueId,
} from "@/lib/kognitos/payload-dashboard-scan";
import {
  inferCoaQtyValFromAutomationOutput,
  payOkFromRecommendationText,
  readDeepExplicitOkFlags,
  readShallowExplicitOkFlags,
} from "@/lib/kognitos/validation-from-automation-output";
import { getRequestIdFromRunPayload } from "@/lib/kognitos/run-payload";
import {
  kognitosRunCompletedAtIso,
  kognitosRunStatusFromPayload,
} from "@/lib/kognitos/run-display";

export type RunPipeline = "pending" | "processed";

export type PeriodFilter = "all" | "30d" | "90d";

function withinPeriod(iso: string, period: PeriodFilter): boolean {
  if (period === "all") return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const days = period === "30d" ? 30 : 90;
  const cutoff = Date.now() - days * 86400000;
  return t >= cutoff;
}

/** Filter runs by `completedAt` or `createdAt` for dashboard period control. */
export function filterRunsByPeriod(
  rows: KognitosDashboardRun[],
  period: PeriodFilter,
): KognitosDashboardRun[] {
  if (period === "all") return rows;
  return rows.filter((r) => {
    const anchor = r.completedAt ?? r.createdAt;
    return withinPeriod(anchor, period);
  });
}

export interface KognitosDashboardRun {
  id: string;
  /**
   * Deep link into the Kognitos web app for this run (server-built when env is configured).
   */
  kognitosRunUrl: string | null;
  vendor: string;
  /** True when `vendor` came from vendor/supplier keys (not title fallback). */
  vendorIsFromDedicatedKeys: boolean;
  invoiceNumber: string;
  /** Title / product line from user inputs (for “top line item” KPI). */
  lineItem: string;
  /** Parsed amount in USD (0 when not present in payload). */
  value: number;
  docOk: boolean;
  qtyOk: boolean;
  valOk: boolean;
  coaOk: boolean;
  payOk: boolean;
  completedAt: string | null;
  createdAt: string;
  pipeline: RunPipeline;
  runStatus: string;
}

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

/** Kognitos / protobuf JSON often wraps scalars (e.g. `{ stringValue: "x" }`). */
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

function firstString(
  o: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const s = stringFromJsonValue(o[k]);
    if (s) return s;
  }
  return undefined;
}

function parseMoney(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.-]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function moneyFromRecordExploratory(
  rec: Record<string, unknown>,
): number {
  let best = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (!/(amount|value|total|price|cost|estimate)/i.test(k)) continue;
    const s = stringFromJsonValue(v);
    if (s) {
      const n = parseMoney(s);
      if (n > best) best = n;
    }
  }
  return best;
}

function valueFromPayload(payload: Record<string, unknown>): number {
  const ui = userInputsObject(payload);
  const fromUi = firstString(ui, [
    "estimated_value",
    "estimatedValue",
    "amount",
    "invoice_value",
    "invoiceValue",
    "total",
    "value",
    "payment_amount",
    "paymentAmount",
  ]);
  if (fromUi) return parseMoney(fromUi);

  const exploratoryUi = moneyFromRecordExploratory(ui);
  if (exploratoryUi > 0) return exploratoryUi;

  const completed = runStateObject(payload)?.completed as
    | Record<string, unknown>
    | undefined;
  const outputs = completed?.outputs as Record<string, unknown> | undefined;
  if (!outputs) return 0;
  const outVal = firstString(outputs, [
    "amount",
    "total",
    "value",
    "payment_amount",
    "paymentAmount",
  ]);
  if (outVal) return parseMoney(outVal);
  return moneyFromRecordExploratory(outputs);
}

function getOutputStatus(payload: Record<string, unknown>): string {
  const completed = runStateObject(payload)?.completed as
    | Record<string, unknown>
    | undefined;
  const outputs = completed?.outputs;
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs))
    return "";
  const o = outputs as Record<string, unknown>;
  const st = o.status ?? o.request_status ?? o.requestStatus;
  return typeof st === "string" ? st.toLowerCase() : "";
}

/**
 * Many Kognitos automations (e.g. P2P match) omit `outputs.status` but still emit
 * `payment_recommendation`. Previously we required a non-empty status for PAY,
 * which kept fully-passing runs in “pending”. Default PAY to pass unless the
 * recommendation clearly blocks payment.
 */
function getMergedOutputsForPaymentText(
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

function inferPayOkWhenWorkflowStatusAbsent(
  payload: Record<string, unknown>,
): boolean {
  const o = getMergedOutputsForPaymentText(payload);
  const pr = firstString(o, [
    "payment_recommendation",
    "paymentRecommendation",
    "payment_status",
    "paymentStatus",
  ]);
  if (pr) {
    const d = payOkFromRecommendationText(pr);
    if (d !== undefined) return d;
  }
  return true;
}

/**
 * PAY is derived: green only when DOC, QTY, VAL, and COA all pass and the
 * payment path is not explicitly blocked; red if any preceding check fails or
 * `payment_recommendation` / explicit `pay_ok` indicates a hold/reject.
 */
function derivePayOkFromPreceding(
  payload: Record<string, unknown>,
  explicit: Partial<{
    docOk: boolean;
    qtyOk: boolean;
    valOk: boolean;
    coaOk: boolean;
    payOk: boolean;
  }>,
  docOk: boolean,
  qtyOk: boolean,
  valOk: boolean,
  coaOk: boolean,
): boolean {
  const precedingOk = docOk && qtyOk && valOk && coaOk;
  if (!precedingOk) return false;
  if (explicit.payOk === false) return false;
  if (explicit.payOk === true) return true;
  const o = getMergedOutputsForPaymentText(payload);
  const pr = firstString(o, [
    "payment_recommendation",
    "paymentRecommendation",
    "payment_status",
    "paymentStatus",
  ]);
  if (pr) {
    const d = payOkFromRecommendationText(pr);
    if (d === false) return false;
    if (d === true) return true;
  }
  return true;
}

/** Status-style heuristic when automation did not emit structured match rows. */
function inferValidationChecksBaseHeuristic(payload: Record<string, unknown>): {
  docOk: boolean;
  qtyOk: boolean;
  valOk: boolean;
  coaOk: boolean;
  payOk: boolean;
} {
  const runStatus = kognitosRunStatusFromPayload(payload);
  const outStatus = getOutputStatus(payload);

  if (runStatus === "Failed") {
    return {
      docOk: false,
      qtyOk: false,
      valOk: false,
      coaOk: false,
      payOk: false,
    };
  }

  if (runStatus !== "Completed") {
    return {
      docOk: false,
      qtyOk: false,
      valOk: false,
      coaOk: false,
      payOk: false,
    };
  }

  if (outStatus === "approved" || outStatus === "closed" || outStatus === "paid") {
    return {
      docOk: true,
      qtyOk: true,
      valOk: true,
      coaOk: true,
      payOk: true,
    };
  }
  if (outStatus === "under_review") {
    return {
      docOk: true,
      qtyOk: true,
      valOk: false,
      coaOk: true,
      payOk: false,
    };
  }
  if (outStatus === "rejected") {
    return {
      docOk: true,
      qtyOk: true,
      valOk: false,
      coaOk: false,
      payOk: false,
    };
  }

  return {
    docOk: true,
    qtyOk: true,
    valOk: true,
    coaOk: true,
    payOk: inferPayOkWhenWorkflowStatusAbsent(payload),
  };
}

export function inferValidationChecks(
  payload: Record<string, unknown>,
): {
  docOk: boolean;
  qtyOk: boolean;
  valOk: boolean;
  coaOk: boolean;
  payOk: boolean;
} {
  const shallow = readShallowExplicitOkFlags(payload);
  const deep = readDeepExplicitOkFlags(payload);
  const explicit: Partial<{
    docOk: boolean;
    qtyOk: boolean;
    valOk: boolean;
    coaOk: boolean;
    payOk: boolean;
  }> = { ...shallow };
  (["docOk", "qtyOk", "valOk", "coaOk", "payOk"] as const).forEach((k) => {
    if (deep[k] !== undefined) explicit[k] = deep[k];
  });

  const auto = inferCoaQtyValFromAutomationOutput(payload);
  const base = inferValidationChecksBaseHeuristic(payload);

  const pick = (
    dim: "docOk" | "qtyOk" | "valOk" | "coaOk" | "payOk",
  ): boolean => {
    if (dim === "coaOk" || dim === "qtyOk" || dim === "valOk") {
      if (auto[dim] !== undefined) return auto[dim]!;
      if (explicit[dim] !== undefined) return explicit[dim]!;
      return base[dim];
    }
    if (explicit[dim] !== undefined) return explicit[dim]!;
    return base[dim];
  };

  const docOk = pick("docOk");
  const qtyOk = pick("qtyOk");
  const valOk = pick("valOk");
  const coaOk = pick("coaOk");
  const payOk = derivePayOkFromPreceding(
    payload,
    explicit,
    docOk,
    qtyOk,
    valOk,
    coaOk,
  );

  return {
    docOk,
    qtyOk,
    valOk,
    coaOk,
    payOk,
  };
}

export function pipelineFromChecks(checks: {
  payOk: boolean;
  valOk: boolean;
  qtyOk: boolean;
  coaOk: boolean;
  docOk: boolean;
}): RunPipeline {
  return checks.payOk &&
    checks.valOk &&
    checks.qtyOk &&
    checks.coaOk &&
    checks.docOk
    ? "processed"
    : "pending";
}

/** When a run’s `request_id` matches a row in `requests`, fill value / display name gaps. */
function numericEstimatedValue(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseFloat(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function enrichDashboardRunWithRequest(
  run: KognitosDashboardRun,
  request:
    | {
        id: string;
        estimated_value: unknown;
        title: string;
        category: string;
      }
    | null
    | undefined,
): KognitosDashboardRun {
  if (!request) return run;
  const fromRequest = numericEstimatedValue(request.estimated_value);
  /** Prefer `requests.estimated_value` when set (canonical for this app). */
  const value =
    fromRequest > 0 ? fromRequest : run.value > 0 ? run.value : 0;

  const vendor = run.vendorIsFromDedicatedKeys
    ? run.vendor
    : request.title?.trim() ||
      request.category?.trim() ||
      run.vendor;
  return { ...run, value, vendor };
}

export function normalizeKognitosRowForDashboard(row: {
  id: string;
  payload: unknown;
  update_time: string | null;
  create_time: string | null;
  /** Automation label (e.g. “P2P 4-Way Match”) — for line-item KPI only, not vendor name. */
  automation_display_name?: string | null;
}): KognitosDashboardRun {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};

  const idpHints = extractIdpProtobufHints(payload);
  const vendorFromIdp = idpHints.vendor?.trim();

  const updateIso =
    typeof row.update_time === "string"
      ? row.update_time
      : row.update_time != null
        ? String(row.update_time)
        : null;
  const createIso =
    typeof row.create_time === "string"
      ? row.create_time
      : row.create_time != null
        ? String(row.create_time)
        : null;

  const ui = userInputsObject(payload);
  const vendorFromInputs =
    firstString(ui, [
      "vendor",
      "vendor_name",
      "vendorName",
      "vendor_legal_name",
      "vendorLegalName",
      "supplier",
      "supplier_name",
      "supplierName",
      "supplier_legal_name",
      "supplierLegalName",
      "company_name",
      "companyName",
      "bill_to_name",
      "billToName",
      "ship_to_name",
      "shipToName",
      "remit_to_name",
      "remitToName",
      "invoice_vendor",
      "invoiceVendor",
    ]) ?? "—";

  const completed = runStateObject(payload)?.completed as
    | Record<string, unknown>
    | undefined;
  const outputs =
    completed?.outputs &&
    typeof completed.outputs === "object" &&
    !Array.isArray(completed.outputs)
      ? (completed.outputs as Record<string, unknown>)
      : {};
  const vendorFromOutputs =
    firstString(outputs, [
      "vendor_name",
      "vendorName",
      "vendor",
      "supplier_name",
      "supplierName",
      "supplier",
      "bill_to_name",
      "billToName",
      "legal_entity_name",
      "legalEntityName",
      "company_name",
      "companyName",
    ]) ?? "—";

  const vendorFromKeys =
    vendorFromInputs !== "—"
      ? vendorFromInputs
      : vendorFromOutputs !== "—"
        ? vendorFromOutputs
        : vendorFromIdp && vendorFromIdp.length > 0
          ? vendorFromIdp
          : "—";

  const vendorDeep = deepVendorHint(payload);
  const vendor =
    vendorFromKeys !== "—"
      ? vendorFromKeys
      : vendorDeep ?? "—";

  const invoiceNumber =
    firstString(ui, [
      "invoice_number",
      "invoiceNumber",
      "invoice_id",
      "invoiceId",
    ]) ??
    idpHints.invoiceNumber ??
    getRequestIdFromRunPayload(payload) ??
    String(row.id);

  const shallowLine = firstString(ui, [
    "title",
    "Title",
    "material",
    "material_name",
    "materialName",
    "product",
    "product_name",
    "productName",
  ]);
  const autoName = row.automation_display_name?.trim();
  const lineItem =
    deepTitleHint(payload) ??
    (shallowLine && !looksLikeOpaqueId(shallowLine) ? shallowLine : undefined) ??
    (!looksLikeOpaqueId(invoiceNumber) ? invoiceNumber : undefined) ??
    (autoName && autoName.length > 0 ? autoName : undefined) ??
    String(row.id);

  const checks = inferValidationChecks(payload);
  const pipeline = pipelineFromChecks(checks);
  const completedAt = kognitosRunCompletedAtIso(payload, updateIso);

  const valueFlat = valueFromPayload(payload);
  const valueDeep = deepMoneyHint(payload);
  const valueIdp = idpHints.totalAmount ?? 0;
  const value = Math.max(valueFlat, valueDeep, valueIdp);

  return {
    id: String(row.id),
    kognitosRunUrl: null,
    vendor,
    vendorIsFromDedicatedKeys:
      vendorFromInputs !== "—" ||
      vendorFromOutputs !== "—" ||
      (vendorFromIdp != null && vendorFromIdp.length > 0),
    invoiceNumber,
    lineItem,
    value,
    docOk: checks.docOk,
    qtyOk: checks.qtyOk,
    valOk: checks.valOk,
    coaOk: checks.coaOk,
    payOk: checks.payOk,
    completedAt,
    createdAt: createIso ?? completedAt ?? new Date(0).toISOString(),
    pipeline,
    runStatus: kognitosRunStatusFromPayload(payload),
  };
}
