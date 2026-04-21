import { NextResponse } from "next/server";

import { getKognitosAutomationRunResultsUrl } from "@/lib/kognitos/automation-details-url";
import {
  type ExpertQueueRow,
  expertQueueIssueBadgeFromWhySummary,
  expertQueueWhySummaryForValidationTags,
  parseExpertQueueIssue,
  resolutionStepsForIssue,
  resolutionStepsForValidationQueue,
  stateLabelForIssue,
  validationTagsFromDashboardChecks,
  whyThisMattersPlainLanguage,
  whyThisMattersValidationQueue,
} from "@/lib/kognitos/expert-queue-issue";
import {
  inferValidationChecks,
  normalizeKognitosRowForDashboard,
} from "@/lib/kognitos/normalize-dashboard-run";
import { kognitosRunReachedCompletedState } from "@/lib/kognitos/run-display";
import { supabaseAdmin } from "@/lib/supabase";

const MAX_ROWS = 500;

/** Newest first; missing timestamps sink to the bottom. */
function compareExpertQueueRows(a: ExpertQueueRow, b: ExpertQueueRow): number {
  const ta =
    Date.parse(a.updateTime ?? a.createTime ?? "") || Number.NEGATIVE_INFINITY;
  const tb =
    Date.parse(b.updateTime ?? b.createTime ?? "") || Number.NEGATIVE_INFINITY;
  if (tb !== ta) return tb - ta;
  return b.runId.localeCompare(a.runId);
}

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing", items: [] },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("id, payload, update_time, create_time, kognitos_automation_id")
    .order("update_time", { ascending: false, nullsFirst: false })
    .order("create_time", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const automationIds = [
    ...new Set(
      rows
        .map((r) => r.kognitos_automation_id as string | null | undefined)
        .filter((x): x is string => Boolean(x)),
    ),
  ];

  const automationExternalIdByUuid = new Map<string, string>();
  const automationNameById = new Map<string, string>();
  if (automationIds.length > 0) {
    const { data: autos, error: autoErr } = await supabaseAdmin
      .from("kognitos_automations")
      .select("id, automation_id, display_name")
      .in("id", automationIds);
    if (!autoErr && autos) {
      for (const a of autos) {
        const row = a as {
          id: string;
          automation_id?: string;
          display_name?: string;
        };
        const ext = String(row.automation_id ?? "").trim();
        if (ext) automationExternalIdByUuid.set(String(row.id), ext);
        const name = String(row.display_name ?? "").trim();
        if (name) automationNameById.set(String(row.id), name);
      }
    }
  }

  const items: ExpertQueueRow[] = [];

  for (const row of rows) {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const issue = parseExpertQueueIssue(payload);
    const checks = inferValidationChecks(payload);
    const validationEligible = kognitosRunReachedCompletedState(payload);
    const validationTags = validationEligible
      ? validationTagsFromDashboardChecks(checks)
      : [];

    if (!issue && validationTags.length === 0) continue;

    const autoUuid = row.kognitos_automation_id as string | null | undefined;
    const extId =
      autoUuid != null
        ? automationExternalIdByUuid.get(String(autoUuid)) ?? null
        : null;
    const kognitosRunUrl =
      extId != null
        ? getKognitosAutomationRunResultsUrl(extId, String(row.id))
        : null;

    const updateTime =
      typeof row.update_time === "string"
        ? row.update_time
        : row.update_time != null
          ? String(row.update_time)
          : null;
    const createTime =
      typeof row.create_time === "string"
        ? row.create_time
        : row.create_time != null
          ? String(row.create_time)
          : null;

    const automationDisplayName =
      autoUuid != null ? automationNameById.get(String(autoUuid)) ?? "—" : "—";
    const normalized = normalizeKognitosRowForDashboard({
      id: String(row.id),
      payload,
      update_time: row.update_time,
      create_time: row.create_time,
      automation_display_name:
        autoUuid != null ? automationNameById.get(String(autoUuid)) ?? null : null,
    });

    if (issue) {
      items.push({
        runId: String(row.id),
        automationDisplayName,
        vendor: normalized.vendor,
        invoiceNumber: normalized.invoiceNumber,
        value: normalized.value,
        stateLabel: stateLabelForIssue(issue.kind),
        issueKind: issue.kind,
        whyItMatters: whyThisMattersPlainLanguage(issue.kind),
        whySummary: issue.whySummary,
        issueBadge: expertQueueIssueBadgeFromWhySummary(issue.whySummary),
        validationTags:
          validationTags.length > 0 ? validationTags : undefined,
        referenceId: issue.referenceId,
        locationHint: issue.locationHint,
        resolutionSteps: resolutionStepsForIssue(issue),
        kognitosRunUrl,
        updateTime,
        createTime,
      });
      continue;
    }

    items.push({
      runId: String(row.id),
      automationDisplayName,
      vendor: normalized.vendor,
      invoiceNumber: normalized.invoiceNumber,
      value: normalized.value,
      stateLabel: "Needs validation review",
      issueKind: "awaiting_guidance",
      whyItMatters: whyThisMattersValidationQueue,
      whySummary: expertQueueWhySummaryForValidationTags(validationTags),
      issueBadge: "other",
      validationTags,
      resolutionSteps: resolutionStepsForValidationQueue(),
      kognitosRunUrl,
      updateTime,
      createTime,
    });
  }

  items.sort(compareExpertQueueRows);

  return NextResponse.json({ items });
}
