import { NextResponse } from "next/server";

import { getIdpHighlightPayloadDiagnostics } from "@/lib/kognitos/idp-invoice-field-highlights";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Returns the raw `kognitos_runs.payload` JSON for a run (ListRuns/GetRun shape).
 * Used by the UI to show full automation output (e.g. markdown validation report).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "supabase_admin_missing", payload: null },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("kognitos_runs")
    .select("payload")
    .eq("id", id)
    .maybeSingle();

  const rowReturned = data != null;
  const payloadExists =
    data != null &&
    data.payload != null &&
    typeof data.payload === "object" &&
    !Array.isArray(data.payload);

  const diag = payloadExists
    ? getIdpHighlightPayloadDiagnostics(data.payload)
    : {
        payloadIsObject: false,
        hasIdpExtractionResults: false,
        fieldsListItemsLength: 0,
        extractedFieldItemsCount: 0,
        normalizedHighlightsCount: 0,
      };

  console.log("[kognitos_runs payload GET]", {
    runId: id,
    kognitosRunsRowReturned: rowReturned,
    kognitosRunsPayloadExists: payloadExists,
    hasIdpExtractionResults: diag.hasIdpExtractionResults,
    fieldsListItemsLength: diag.fieldsListItemsLength,
    extractedFieldItemsCount: diag.extractedFieldItemsCount,
    normalizedHighlightsCount: diag.normalizedHighlightsCount,
    supabaseError: error?.message ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.payload) {
    return NextResponse.json({ payload: null }, { status: 404 });
  }

  return NextResponse.json({ payload: data.payload });
}
