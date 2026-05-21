/**
 * Parsers for the inline-XML payloads that the Kognitos `astral` agent embeds in
 * chat message content. Mirrors the regex-based approach used in the
 * `kognitos/bumblebee` UI (`src/shared/utils/chat-utils.tsx` and
 * `src/shared/hooks/useRunChat.tsx`) so this app can render the same widgets.
 *
 * Supported tags:
 *   - `<related_outputs context="..." source="...">` agent-side IDP fact extraction
 *     (with optional nested `<facts source="..." page="...">` groups containing
 *     `<fact field="..." type="..." status="present|missing">value</fact>`).
 *   - `<guide_entry action="...">` agent-side troubleshooting guide proposals.
 *   - `<user_action type="edit_facts">` user-side IDP edits sent back to the agent.
 *
 * All parsers strip the matched XML from the returned `cleanedContent` so callers
 * can render the remaining prose as markdown and the structured payload as a
 * widget.
 */

export type AstralFactStatus = "present" | "missing";

export interface ParsedFact {
  field: string;
  type: string;
  status: AstralFactStatus;
  value?: string;
  options?: string[];
  pageNumber?: number;
  confidence?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ParsedFactSource {
  name?: string;
  page?: number;
}

export interface ParsedFactGroup {
  source?: ParsedFactSource;
  facts: ParsedFact[];
}

export type RelatedOutputsContext =
  | "need_information"
  | "analyze_outputs"
  | "manual_action_required";

export interface ParsedRelatedOutputs {
  context: RelatedOutputsContext | null;
  /** Top-level `source` attribute on `<related_outputs>` (legacy/flat format). */
  source: string | null;
  factGroups: ParsedFactGroup[];
  /** Flat array of every fact across all groups (convenience for counts/lookup). */
  facts: ParsedFact[];
}

export interface ParseRelatedOutputsResult {
  cleanedContent: string;
  relatedOutputs: ParsedRelatedOutputs | null;
}

export interface ParsedGuideEntry {
  action: "create" | "update" | "use";
  /** Full resource name (organizations/.../guideEntries/{id}); may be empty. */
  name: string;
  title: string;
  rootCause: string;
  resolutionSteps?: string;
  /** Legacy `<content>` field, retained for backward compatibility. */
  legacyContent?: string;
  state: string;
  version: string;
}

export interface ParseGuideEntryResult {
  cleanedContent: string;
  guideEntry: ParsedGuideEntry | null;
}

export interface EditedFact {
  name: string;
  type: string;
  value: string;
  original?: string;
  source?: ParsedFactSource;
}

export interface ParseEditFactsResult {
  cleanedContent: string;
  editedFacts: EditedFact[] | null;
}

const RELATED_OUTPUTS_RE = /<related_outputs([^>]*)>([\s\S]*?)<\/related_outputs>/i;
const GUIDE_ENTRY_RE = /<guide_entry([^>]*)>([\s\S]*?)<\/guide_entry>/i;
const USER_ACTION_EDIT_FACTS_RE =
  /<user_action[^>]*\btype\s*=\s*["']edit_facts["'][^>]*>([\s\S]*?)<\/user_action>/i;

/** Order matters: `&amp;` must be last to avoid double-unescaping. */
export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readAttr(element: string, attrName: string): string | undefined {
  const m = element.match(new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']*)["']`));
  return m ? m[1] : undefined;
}

function readNumericAttr(
  element: string,
  attrName: string,
  parser: (raw: string) => number,
): number | undefined {
  const raw = readAttr(element, attrName);
  if (raw === undefined) return undefined;
  const parsed = parser(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readJsonAttr<T>(element: string, attrName: string): T | undefined {
  const raw = readAttr(element, attrName);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(unescapeXml(raw)) as T;
  } catch {
    return undefined;
  }
}

function parseFactElement(factElement: string): ParsedFact | null {
  const field = readAttr(factElement, "field");
  const type = readAttr(factElement, "type");
  const statusRaw = readAttr(factElement, "status");
  if (!field || !type || (statusRaw !== "present" && statusRaw !== "missing")) {
    return null;
  }

  const valueMatch = factElement.match(/>([\s\S]*)<\/fact\s*>/i);
  const value = valueMatch ? unescapeXml(valueMatch[1].trim()) : undefined;

  const optionsRaw = readAttr(factElement, "options");
  const options = optionsRaw
    ? optionsRaw
        .split("|")
        .map((o) => unescapeXml(o.trim()))
        .filter((o) => o.length > 0)
    : undefined;

  const pageNumber = readNumericAttr(factElement, "page_number", (s) =>
    parseInt(s, 10),
  );
  const confidence = readNumericAttr(factElement, "confidence", parseFloat);
  const boundingBox = readJsonAttr<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>(factElement, "bounding_box");

  return {
    field: unescapeXml(field),
    type: unescapeXml(type),
    status: statusRaw,
    ...(value !== undefined && value.length > 0 && { value }),
    ...(options && options.length > 0 && { options }),
    ...(pageNumber !== undefined && { pageNumber }),
    ...(confidence !== undefined && { confidence }),
    ...(boundingBox && { boundingBox }),
  };
}

function parseFactsGroupElement(factsElement: string): ParsedFactGroup | null {
  const sourceName = readAttr(factsElement, "source");
  const pageRaw = readAttr(factsElement, "page");
  const pageParsed = pageRaw !== undefined ? parseInt(pageRaw, 10) : NaN;
  const page = Number.isFinite(pageParsed) ? pageParsed : undefined;

  const factMatches =
    factsElement.match(/<fact\s+[^>]*(?:\/>|>[\s\S]*?<\/fact\s*>)/gi) ?? [];
  const facts: ParsedFact[] = [];
  for (const f of factMatches) {
    const parsed = parseFactElement(f);
    if (parsed) facts.push(parsed);
  }
  if (facts.length === 0) return null;

  const source: ParsedFactSource | undefined =
    sourceName !== undefined || page !== undefined
      ? { ...(sourceName && { name: sourceName }), ...(page !== undefined && { page }) }
      : undefined;

  return source ? { source, facts } : { facts };
}

/**
 * Parse the first `<related_outputs>` block out of `content`.
 * Supports both the new `<facts>`-grouped format and the legacy flat `<fact>` form.
 */
export function parseRelatedOutputsXml(
  content: string,
): ParseRelatedOutputsResult {
  const match = content.match(RELATED_OUTPUTS_RE);
  if (!match) {
    return { cleanedContent: content, relatedOutputs: null };
  }

  const attributes = match[1];
  const inner = match[2];

  const sourceAttr = readAttr(attributes, "source") ?? null;
  const contextAttr = readAttr(attributes, "context");
  const context: RelatedOutputsContext | null =
    contextAttr === "need_information" ||
    contextAttr === "analyze_outputs" ||
    contextAttr === "manual_action_required"
      ? contextAttr
      : null;

  const factGroups: ParsedFactGroup[] = [];
  const allFacts: ParsedFact[] = [];

  const groupMatches = inner.match(/<facts([^>]*)>([\s\S]*?)<\/facts>/gi);
  if (groupMatches && groupMatches.length > 0) {
    for (const g of groupMatches) {
      const group = parseFactsGroupElement(g);
      if (group) {
        factGroups.push(group);
        allFacts.push(...group.facts);
      }
    }
  } else {
    // Legacy flat <fact> children of <related_outputs>.
    const flatFactMatches =
      inner.match(/<fact\s+[^>]*(?:\/>|>[\s\S]*?<\/fact\s*>)/gi) ?? [];
    const facts: ParsedFact[] = [];
    for (const f of flatFactMatches) {
      const parsed = parseFactElement(f);
      if (parsed) facts.push(parsed);
    }
    if (facts.length > 0) {
      const source: ParsedFactSource | undefined = sourceAttr
        ? { name: sourceAttr }
        : undefined;
      factGroups.push(source ? { source, facts } : { facts });
      allFacts.push(...facts);
    }
  }

  const cleanedContent = content.replace(RELATED_OUTPUTS_RE, "").trim();

  if (factGroups.length === 0 && context === null && sourceAttr === null) {
    // Empty XML payload — strip the tag but don't surface a widget.
    return { cleanedContent, relatedOutputs: null };
  }

  return {
    cleanedContent,
    relatedOutputs: {
      context,
      source: sourceAttr,
      factGroups,
      facts: allFacts,
    },
  };
}

/**
 * Parse the first `<guide_entry>` block out of `content`.
 * Returns `null` if required fields (`<name>` and `<title>`) are missing.
 */
export function parseGuideEntryXml(content: string): ParseGuideEntryResult {
  const match = content.match(GUIDE_ENTRY_RE);
  if (!match) {
    return { cleanedContent: content, guideEntry: null };
  }

  const attributes = match[1];
  const inner = match[2];

  const actionAttr = readAttr(attributes, "action");
  const action: ParsedGuideEntry["action"] =
    actionAttr === "update" || actionAttr === "use" ? actionAttr : "create";

  const extractTag = (tag: string): string => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
    const m = inner.match(re);
    return m ? unescapeXml(m[1].trim()) : "";
  };

  const name = extractTag("name");
  const title = extractTag("title");
  if (!name || !title) {
    return { cleanedContent: content, guideEntry: null };
  }

  const guideEntry: ParsedGuideEntry = {
    action,
    name,
    title,
    rootCause: extractTag("root_cause"),
    state: extractTag("state"),
    version: extractTag("version"),
  };

  const resolutionSteps = extractTag("resolution_steps");
  if (resolutionSteps) guideEntry.resolutionSteps = resolutionSteps;

  const legacyContent = extractTag("content");
  if (legacyContent) guideEntry.legacyContent = legacyContent;

  return {
    cleanedContent: content.replace(GUIDE_ENTRY_RE, "").trim(),
    guideEntry,
  };
}

/**
 * Parse the first `<user_action type="edit_facts">` block out of `content`.
 * Each `<fact name="..." type="..."><original>..</original><value>..</value></fact>`
 * becomes one `EditedFact`. `<facts source="..." page="...">` group attributes are
 * carried onto each contained fact so the UI can show source attribution.
 */
export function parseEditFactsXml(content: string): ParseEditFactsResult {
  const match = content.match(USER_ACTION_EDIT_FACTS_RE);
  if (!match) {
    return { cleanedContent: content, editedFacts: null };
  }

  const inner = match[1];
  const editedFacts: EditedFact[] = [];

  const groupMatches = inner.match(/<facts([^>]*)>([\s\S]*?)<\/facts>/gi);
  if (groupMatches && groupMatches.length > 0) {
    for (const g of groupMatches) {
      const sourceName = readAttr(g, "source");
      const pageRaw = readAttr(g, "page");
      const pageParsed = pageRaw !== undefined ? parseInt(pageRaw, 10) : NaN;
      const page = Number.isFinite(pageParsed) ? pageParsed : undefined;
      const source: ParsedFactSource | undefined =
        (sourceName && sourceName.length > 0) || page !== undefined
          ? {
              ...(sourceName && sourceName.length > 0 && { name: sourceName }),
              ...(page !== undefined && { page }),
            }
          : undefined;

      const innerFactMatches =
        g.match(/<fact[^>]*>[\s\S]*?<\/fact\s*>/gi) ?? [];
      for (const f of innerFactMatches) {
        const ef = parseEditFactElement(f);
        if (ef) editedFacts.push(source ? { ...ef, source } : ef);
      }
    }
  } else {
    // Flat <fact> children directly inside <user_action>.
    const flatFactMatches = inner.match(/<fact[^>]*>[\s\S]*?<\/fact\s*>/gi) ?? [];
    for (const f of flatFactMatches) {
      const ef = parseEditFactElement(f);
      if (ef) editedFacts.push(ef);
    }
  }

  return {
    cleanedContent: content.replace(USER_ACTION_EDIT_FACTS_RE, "").trim(),
    editedFacts: editedFacts.length > 0 ? editedFacts : null,
  };
}

function parseEditFactElement(factElement: string): EditedFact | null {
  const name = readAttr(factElement, "name");
  if (!name) return null;
  const type = readAttr(factElement, "type") ?? "text";

  const valueMatch = factElement.match(/<value>([\s\S]*?)<\/value>/i);
  if (!valueMatch) return null;
  const value = unescapeXml(valueMatch[1]);

  const originalMatch = factElement.match(/<original>([\s\S]*?)<\/original>/i);
  const original = originalMatch ? unescapeXml(originalMatch[1]) : undefined;

  return {
    name: unescapeXml(name),
    type: unescapeXml(type),
    value,
    ...(original !== undefined && { original }),
  };
}

/**
 * Convenience: run all agent-side parsers in sequence, returning the fully
 * cleaned text plus any widget payloads that were found. The cleaned text has
 * `<related_outputs>` and `<guide_entry>` blocks removed.
 */
export interface ParsedAgentMessage {
  cleanedContent: string;
  relatedOutputs: ParsedRelatedOutputs | null;
  guideEntry: ParsedGuideEntry | null;
}

export function parseAstralAgentMessageContent(
  content: string,
): ParsedAgentMessage {
  const ro = parseRelatedOutputsXml(content);
  const ge = parseGuideEntryXml(ro.cleanedContent);
  return {
    cleanedContent: ge.cleanedContent,
    relatedOutputs: ro.relatedOutputs,
    guideEntry: ge.guideEntry,
  };
}

/**
 * Convenience: run user-side parsers, returning cleaned text plus edit-facts
 * payload if present.
 */
export interface ParsedUserMessage {
  cleanedContent: string;
  editedFacts: EditedFact[] | null;
}

export function parseAstralUserMessageContent(
  content: string,
): ParsedUserMessage {
  const ef = parseEditFactsXml(content);
  return {
    cleanedContent: ef.cleanedContent,
    editedFacts: ef.editedFacts,
  };
}

/** XML-escape a value for safe inclusion in `<user_action type="edit_facts">`. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Map a parsed-fact `type` string to the XML type the agent expects. */
export function normalizeEditFactType(type: string | undefined): string {
  if (!type) return "text";
  const lower = type.toLowerCase();
  if (lower === "number" || lower === "table") return lower;
  return "text";
}

export interface BuildEditFactInput {
  /** Field name, e.g. `po_number`. */
  name: string;
  /** Display type — coerced to `text|number|table`. */
  type?: string;
  /** Original/extracted value (empty string for missing facts). */
  original?: string;
  /** New value supplied by the user. */
  value: string;
}

export interface BuildEditFactsGroupInput {
  source?: ParsedFactSource;
  facts: BuildEditFactInput[];
}

/**
 * Serialize a list of edited fact groups into the `<user_action type="edit_facts">`
 * XML format the `astral` agent expects. Mirrors bumblebee's
 * `convertFactGroupsToXml` so the receiving agent can consume the response.
 *
 * Empty groups (no facts) are omitted. Returns `null` if every group is empty,
 * so the caller can avoid sending an empty action.
 */
export function buildEditFactsXml(
  groups: BuildEditFactsGroupInput[],
): string | null {
  const nonEmpty = groups.filter((g) => g.facts.length > 0);
  if (nonEmpty.length === 0) return null;

  const groupsXml = nonEmpty
    .map((group) => {
      const sourceAttr = ` source="${escapeXml(group.source?.name ?? "")}"`;
      const pageAttr =
        group.source?.page !== undefined
          ? ` page="${group.source.page}"`
          : ` page=""`;
      const factsXml = group.facts
        .map((fact) => {
          const xmlType = normalizeEditFactType(fact.type);
          const original = fact.original ?? "";
          return `    <fact name="${escapeXml(fact.name)}" type="${xmlType}">
      <original>${escapeXml(original)}</original>
      <value>${escapeXml(fact.value)}</value>
    </fact>`;
        })
        .join("\n");
      return `  <facts${sourceAttr}${pageAttr}>
${factsXml}
  </facts>`;
    })
    .join("\n");

  return `<user_action type="edit_facts">
${groupsXml}
</user_action>`;
}

/**
 * Build edit-facts XML from a previously-parsed `<related_outputs>` payload and
 * a flat `{ fieldName: newValue }` map. Preserves source attribution per group
 * and skips groups with no edited values.
 */
export function buildEditFactsXmlFromRelatedOutputs(
  relatedOutputs: ParsedRelatedOutputs,
  editedValues: Record<string, string>,
): string | null {
  const groups: BuildEditFactsGroupInput[] = relatedOutputs.factGroups.map(
    (group) => ({
      source: group.source,
      facts: group.facts
        .filter((f) => {
          const v = editedValues[f.field];
          return typeof v === "string" && v.trim().length > 0;
        })
        .map((f) => ({
          name: f.field,
          type: f.type,
          original: f.value ?? "",
          value: editedValues[f.field].trim(),
        })),
    }),
  );
  return buildEditFactsXml(groups);
}
