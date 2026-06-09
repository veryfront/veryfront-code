import { historicalToolSummaries } from "../../integrations/_tool_summaries.ts";
import type { IntegrationEndpointHistoricalSummary } from "../../integrations/schema.ts";

type SummaryField = IntegrationEndpointHistoricalSummary["itemFields"][number];
type ToolStatus = "success" | "empty" | "error";

export type CurrentRunToolEvidence = {
  recordId: string;
  fields: Record<string, string>;
};

export type CurrentRunToolStateCall = {
  toolCallIds: string[];
  input: unknown;
  status: ToolStatus;
  summary: unknown;
  evidence?: CurrentRunToolEvidence[];
  updatedAt: string;
};

export type CurrentRunToolState = Record<
  string,
  { calls: Record<string, CurrentRunToolStateCall> }
>;

export type RecordCurrentRunToolResultInput = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result: unknown;
  now?: Date;
};

export type CurrentRunToolStateHydrationMessage = {
  role?: string;
  parts?: readonly unknown[];
};
export type CurrentRunToolStateRuntimeContextPart = {
  type: "runtime-context";
  name: "current-run-tool-state";
  state: CurrentRunToolState;
};

const MAX_FALLBACK_ITEMS = 5;
const MAX_FALLBACK_STRING_LENGTH = 300;
const MAX_OBJECT_ARRAY_ITEMS = 5;
const MAX_EVIDENCE_TEXT_LENGTH = 20_000;
const MAX_EVIDENCE_STRINGS = 12;
const MAX_EVIDENCE_RECORDS = 25;
const MAX_EVIDENCE_FIELDS_PER_RECORD = 12;
const MAX_STRUCTURED_ASSERTION_LINES = 80;
const RECORD_ID_PATTERN = /\b[A-Z][A-Z0-9]+-\d{4}-\d{3,}\b/g;
const GUARDED_FACT_ALIASES: Record<string, string[]> = {
  supplier: ["supplier", "vendor"],
  vendor: ["vendor", "supplier"],
  customer: ["customer", "client"],
  client: ["client", "customer"],
  owner: ["owner", "assignee", "assigned_to"],
  assignee: ["assignee", "owner", "assigned_to"],
  company: ["company", "organization", "account"],
  account: ["account", "company", "organization"],
};
const NON_EVIDENCE_TOOL_NAMES = new Set([
  "load_skill",
  "load_skill_reference",
  "execute_skill_script",
]);
const WEAK_FIELD_MATCH_TOKENS = new Set([
  "id",
  "ids",
  "name",
  "names",
  "ref",
  "refs",
  "reference",
  "references",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownCell(value: string): string {
  return normalizeWhitespace(value.replace(/^[-–—>→\s]+/, "").replace(/\*\*/g, ""));
}

function normalizeEvidenceField(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeEvidenceValue(value: string): string {
  return stripMarkdownCell(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?;,]+$/g, "")
    .trim();
}

function getRecordIds(value: string): string[] {
  return Array.from(new Set(value.match(RECORD_ID_PATTERN) ?? []));
}

function mergeEvidenceField(
  evidenceByRecordId: Map<string, Record<string, string>>,
  recordId: string,
  field: string,
  value: string,
): void {
  const normalizedField = normalizeEvidenceField(field);
  const normalizedValue = normalizeEvidenceValue(value);
  if (!normalizedField || !normalizedValue || normalizedValue === recordId) return;
  if (getRecordIds(normalizedValue).includes(recordId)) return;

  const fields = evidenceByRecordId.get(recordId) ?? {};
  if (
    Object.keys(fields).length >= MAX_EVIDENCE_FIELDS_PER_RECORD && !(normalizedField in fields)
  ) {
    return;
  }
  fields[normalizedField] = truncate(normalizedValue, 160);
  evidenceByRecordId.set(recordId, fields);
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutOuterPipes.split("|").map(stripMarkdownCell);
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = withoutOuterPipes.split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function collectStringLeaves(value: unknown, strings: string[] = []): string[] {
  if (strings.length >= MAX_EVIDENCE_STRINGS) return strings;

  if (typeof value === "string") {
    if (value.trim()) strings.push(value.slice(0, MAX_EVIDENCE_TEXT_LENGTH));
    return strings;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, strings);
    return strings;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) collectStringLeaves(entry, strings);
  }
  return strings;
}

function extractEvidenceFromMarkdownTable(
  lines: readonly string[],
  startIndex: number,
  evidenceByRecordId: Map<string, Record<string, string>>,
): number {
  const headers = parseMarkdownTableRow(lines[startIndex] ?? "");
  let cursor = startIndex + 2;
  const rows: string[][] = [];

  while (cursor < lines.length && lines[cursor]?.includes("|")) {
    const row = parseMarkdownTableRow(lines[cursor] ?? "");
    if (row.length === headers.length) rows.push(row);
    cursor++;
  }

  const keyValueRows = rows.filter((row) => row.length >= 2);
  const isKeyValueTable = headers.length === 2 &&
    normalizeEvidenceField(headers[0] ?? "") === "field" &&
    normalizeEvidenceField(headers[1] ?? "") === "value";
  const primaryRecordId = keyValueRows
    .map((row) => getRecordIds(row[1] ?? "")[0])
    .find((recordId): recordId is string => typeof recordId === "string");

  if (isKeyValueTable && primaryRecordId) {
    for (const row of keyValueRows) {
      mergeEvidenceField(evidenceByRecordId, primaryRecordId, row[0] ?? "", row[1] ?? "");
    }
    return cursor;
  }

  for (const row of rows) {
    const recordId = row.flatMap(getRecordIds)[0];
    if (!recordId) continue;

    for (const [index, value] of row.entries()) {
      const field = headers[index] ?? "";
      if (!field || getRecordIds(value).includes(recordId)) continue;
      mergeEvidenceField(evidenceByRecordId, recordId, field, value);
    }
  }

  return cursor;
}

export function extractCurrentRunEvidence(result: unknown): CurrentRunToolEvidence[] {
  const evidenceByRecordId = new Map<string, Record<string, string>>();

  for (const text of collectStringLeaves(result)) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (!line.includes("|") || !lines[index + 1]?.includes("|")) continue;
      if (!isMarkdownTableSeparator(lines[index + 1] ?? "")) continue;
      index = extractEvidenceFromMarkdownTable(lines, index, evidenceByRecordId) - 1;
    }
  }

  return Array.from(evidenceByRecordId.entries())
    .slice(0, MAX_EVIDENCE_RECORDS)
    .map(([recordId, fields]) => ({ recordId, fields }));
}

function getEvidenceFieldsForRecord(
  state: CurrentRunToolState,
  recordId: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const bucket of Object.values(state)) {
    for (const call of Object.values(bucket.calls)) {
      for (const evidence of call.evidence ?? []) {
        if (evidence.recordId !== recordId) continue;
        Object.assign(fields, evidence.fields);
      }
    }
  }
  return fields;
}

function getExpectedEvidenceField(
  fields: Record<string, string>,
  field: string,
): { field: string; value: string } | null {
  const aliases = GUARDED_FACT_ALIASES[field] ?? [field];
  for (const alias of aliases) {
    if (fields[alias]) return { field: alias, value: fields[alias] };
  }
  return null;
}

function getCompatibleEvidenceField(
  fields: Record<string, string>,
  field: string,
): { field: string; value: string } | null {
  const expected = getExpectedEvidenceField(fields, field);
  if (expected) return expected;

  const fieldTokens = getComparableFieldTokens(field);
  if (fieldTokens.length === 0) return null;

  for (const [evidenceField, value] of Object.entries(fields)) {
    const evidenceTokens = getComparableFieldTokens(evidenceField);
    if (evidenceTokens.length === 0) continue;
    if (
      fieldTokens.length === evidenceTokens.length && fieldTokens.every((token, index) => {
        return token === evidenceTokens[index];
      })
    ) {
      return { field: evidenceField, value };
    }
  }

  return null;
}

function getComparableFieldTokens(field: string): string[] {
  return field.split("_").filter((token) => token && !WEAK_FIELD_MATCH_TOKENS.has(token));
}

function hasCompanyLikeShape(value: string): boolean {
  if (getRecordIds(value).length > 0) return false;
  if (/[€$£¥]\s?\d|\d{4,}/.test(value)) return false;
  if (/\b(invoice|record|item|payment|approval|escalation|matching)\b/i.test(value)) return false;
  return /\b(GmbH|LLC|Ltd|Limited|Inc|Corp|Corporation|Company|Co\.?|AG|SA|BV|NV|PLC)\b/.test(
    value,
  ) ||
    /^[A-Z][\p{L}'&.-]+(?:\s+[A-Z][\p{L}'&.-]+)+$/u.test(value);
}

function extractAssertedFieldValues(text: string): Array<{ field: string; value: string }> {
  const assertions: Array<{ field: string; value: string }> = [];

  for (const field of Object.keys(GUARDED_FACT_ALIASES)) {
    const aliases = GUARDED_FACT_ALIASES[field] ?? [field];
    for (const alias of aliases) {
      const pattern = new RegExp(
        `\\b${
          alias.replace(/_/g, "[ _-]")
        }\\b\\s*(?:is|:|=|named|called)?\\s+(.{2,100}?)(?=\\s+(?:for|with|matched|against|on|and|to|has|was|will|ready|blocked|created|released)\\b|[.,;\\n]|$)`,
        "giu",
      );
      for (const match of text.matchAll(pattern)) {
        const value = normalizeEvidenceValue(match[1] ?? "");
        if (hasCompanyLikeShape(value)) assertions.push({ field, value });
      }
    }
  }
  return assertions;
}

function valuesConflict(actual: string, expected: string): boolean {
  const left = normalizeComparableValue(actual);
  const right = normalizeComparableValue(expected);
  return left !== right && !left.includes(right) && !right.includes(left);
}

function normalizeComparableValue(value: string): string {
  const normalized = normalizeWhitespace(value).toLowerCase();
  const numeric = normalizeNumericValue(value);
  return numeric ?? normalized;
}

function normalizeNumericValue(value: string): string | null {
  const compact = normalizeWhitespace(value)
    .replace(/\p{Sc}/gu, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(compact)) return null;

  const parsed = Number.parseFloat(compact);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRecordBoundaryPattern(recordIds: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${recordIds.map(escapeRegExp).join("|")})\\b`, "g");
}

function getRecordTextWindows(
  text: string,
  recordId: string,
  boundaryRecordIds: readonly string[],
): string[] {
  const windows: string[] = [];
  const pattern = new RegExp(escapeRegExp(recordId), "g");
  const boundaryPattern = getRecordBoundaryPattern(boundaryRecordIds);

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = text.slice(0, index);
    const after = text.slice(index + recordId.length);
    const previousRecordMatches = Array.from(before.matchAll(boundaryPattern));
    const previousRecordMatch = previousRecordMatches.at(-1);
    const previousRecordEnd = previousRecordMatch && typeof previousRecordMatch.index === "number"
      ? previousRecordMatch.index + previousRecordMatch[0].length
      : -1;
    const windowStart = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("\n"),
      before.lastIndexOf(";"),
    );
    boundaryPattern.lastIndex = 0;
    const nextRecordMatch = boundaryPattern.exec(after);
    const nextRecordIndex = nextRecordMatch?.index;
    const windowEnd = typeof nextRecordIndex === "number"
      ? Math.max(0, nextRecordIndex)
      : Math.min(after.length, 300);
    windows.push(
      normalizeWhitespace(
        text.slice(
          Math.max(
            previousRecordEnd,
            windowStart >= 0 ? windowStart + 1 : Math.max(0, index - 160),
          ),
          index + recordId.length + windowEnd,
        ),
      ),
    );
  }

  return windows;
}

function primitiveStructuredValueToString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function collectStructuredAssertionLines(
  value: unknown,
  lines: string[] = [],
  path: string[] = [],
): string[] {
  if (lines.length >= MAX_STRUCTURED_ASSERTION_LINES) return lines;

  const primitiveValue = primitiveStructuredValueToString(value);
  if (primitiveValue !== null && path.length > 0) {
    lines.push(`${path.join(".")}: ${truncate(primitiveValue, 300)}`);
    return lines;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredAssertionLines(item, lines, path);
      if (lines.length >= MAX_STRUCTURED_ASSERTION_LINES) break;
    }
    return lines;
  }

  if (!isRecord(value)) return lines;

  for (const [key, entry] of Object.entries(value)) {
    collectStructuredAssertionLines(entry, lines, [...path, key]);
    if (lines.length >= MAX_STRUCTURED_ASSERTION_LINES) break;
  }

  return lines;
}

type StructuredContextFieldAssertion = {
  recordId: string;
  field: string;
  value: string;
};

function directRecordIdsFromRecord(value: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const entry of Object.values(value)) {
    const primitiveValue = primitiveStructuredValueToString(entry);
    if (primitiveValue !== null) ids.push(...getRecordIds(primitiveValue));
  }
  return Array.from(new Set(ids));
}

function collectStructuredContextFieldAssertions(
  value: unknown,
  assertions: StructuredContextFieldAssertion[] = [],
  activeRecordIds: readonly string[] = [],
  fieldName?: string,
): StructuredContextFieldAssertion[] {
  const primitiveValue = primitiveStructuredValueToString(value);
  if (primitiveValue !== null) {
    if (fieldName) {
      const field = normalizeEvidenceField(fieldName);
      for (const recordId of activeRecordIds) {
        if (primitiveValue === recordId) continue;
        assertions.push({ recordId, field, value: primitiveValue });
      }
    }
    return assertions;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredContextFieldAssertions(item, assertions, activeRecordIds, fieldName);
    }
    return assertions;
  }

  if (!isRecord(value)) return assertions;

  const directRecordIds = directRecordIdsFromRecord(value);
  const recordIds = directRecordIds.length > 0 ? directRecordIds : activeRecordIds;
  for (const [key, entry] of Object.entries(value)) {
    collectStructuredContextFieldAssertions(entry, assertions, recordIds, key);
  }

  return assertions;
}

export function validateInvokeAgentInputAgainstCurrentRunEvidence(
  state: CurrentRunToolState,
  input: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: true };
  const text = normalizeWhitespace(
    [
      input.prompt,
      input.description,
      input.input,
      ...collectStructuredAssertionLines(input.context),
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
  );
  if (!text) return { ok: true };

  const recordIds = getRecordIds(text).filter((recordId) =>
    Object.keys(getEvidenceFieldsForRecord(state, recordId)).length > 0
  );
  for (const recordId of recordIds) {
    const evidenceFields = getEvidenceFieldsForRecord(state, recordId);
    for (const window of getRecordTextWindows(text, recordId, recordIds)) {
      for (const assertion of extractAssertedFieldValues(window)) {
        const expected = getExpectedEvidenceField(evidenceFields, assertion.field);
        if (!expected || !valuesConflict(assertion.value, expected.value)) continue;
        return {
          ok: false,
          error:
            `invoke_agent input conflicts with current run evidence: ${recordId} ${expected.field} is ` +
            `"${expected.value}", but the tool input says "${assertion.value}". ` +
            "Regenerate the tool call from recorded evidence, or delegate only the record id.",
        };
      }
    }
  }

  for (const assertion of collectStructuredContextFieldAssertions(input.context)) {
    const evidenceFields = getEvidenceFieldsForRecord(state, assertion.recordId);
    const expected = getCompatibleEvidenceField(evidenceFields, assertion.field);
    if (!expected || !valuesConflict(assertion.value, expected.value)) continue;

    return {
      ok: false,
      error:
        `invoke_agent context conflicts with current run evidence: ${assertion.recordId} ${expected.field} is ` +
        `"${expected.value}", but context.${assertion.field} is "${assertion.value}". ` +
        "Regenerate the tool call from recorded evidence, or delegate only the record id.",
    };
  }

  return { ok: true };
}

function normalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeForFingerprint(value[key]);
  }
  return normalized;
}

export function createToolInputFingerprint(input: unknown): string {
  return JSON.stringify(normalizeForFingerprint(input ?? {}));
}

function compactContactValue(value: unknown): Record<string, unknown> | string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;

  const compact: Record<string, unknown> = {};
  const emailAddress = value.emailAddress;

  if (isRecord(emailAddress)) {
    if (typeof emailAddress.name === "string") compact.name = emailAddress.name;
    if (typeof emailAddress.address === "string") compact.address = emailAddress.address;
  }

  for (const field of ["login", "name", "address", "email", "id"] as const) {
    if (typeof value[field] === "string" || typeof value[field] === "number") {
      compact[field] = value[field];
    }
  }

  return Object.keys(compact).length > 0 ? compact : null;
}

function compactObjectValue(value: unknown, depth = 2): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? truncate(value, MAX_FALLBACK_STRING_LENGTH) : value;
  }

  if (Array.isArray(value)) {
    const compacted = value.slice(0, MAX_OBJECT_ARRAY_ITEMS)
      .map((item) => compactObjectValue(item, depth - 1))
      .filter((item) => item !== null);
    return compacted.length > 0 ? compacted : null;
  }

  if (!isRecord(value) || depth < 0) return null;

  const compact: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const compacted = compactObjectValue(entry, depth - 1);
    if (compacted !== null) compact[key] = compacted;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function compactField(field: SummaryField, value: unknown): unknown {
  if (field.kind === "contact") return compactContactValue(value);

  if (field.kind === "contact-array") {
    if (!Array.isArray(value)) return null;
    const contacts = value
      .map((item) => compactContactValue(item))
      .filter((item): item is Record<string, unknown> | string => item !== null);
    return contacts.length > 0 ? contacts : null;
  }

  if (field.kind === "string-array") {
    if (!Array.isArray(value)) return null;
    const strings = value.filter((item) => typeof item === "string");
    return strings.length > 0 ? strings : null;
  }

  if (field.kind === "object") {
    return compactObjectValue(value);
  }

  if (typeof value === "string") {
    return field.maxLength ? truncate(value, field.maxLength) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === "string");
    return strings.length > 0 ? strings : null;
  }
  return null;
}

function compactItem(
  value: unknown,
  fields: readonly SummaryField[],
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const compact: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldValue = compactField(field, value[field.name]);
    if (fieldValue !== null) compact[field.name] = fieldValue;
  }

  return Object.keys(compact).length > 0 ? compact : null;
}

function getSummaryItems(
  result: unknown,
  contract: IntegrationEndpointHistoricalSummary,
): readonly unknown[] | null {
  if (Array.isArray(result)) return result;
  if (!isRecord(result)) return null;

  for (const key of contract.collectionKeys) {
    const value = result[key];
    if (Array.isArray(value)) return value;
  }

  if (contract.singleItem) return [result];
  return null;
}

function summarizeWithContract(
  result: unknown,
  contract: IntegrationEndpointHistoricalSummary,
): { summary: Record<string, unknown>; status: ToolStatus } | null {
  const sourceItems = getSummaryItems(result, contract);
  if (!sourceItems) return null;

  const items = sourceItems
    .map((item) => compactItem(item, contract.itemFields))
    .filter((item): item is Record<string, unknown> => item !== null);

  const summary: Record<string, unknown> = {
    [`${contract.collectionName}Count`]: sourceItems.length,
    [contract.collectionName]: items,
    omitted: contract.omitted,
  };

  if (isRecord(result) && contract.outputFields) {
    for (const field of contract.outputFields) {
      const fieldValue = compactField(field, result[field.name]);
      if (fieldValue !== null) summary[field.name] = fieldValue;
    }
  }

  return {
    summary,
    status: sourceItems.length === 0 ? "empty" : "success",
  };
}

function summarizeFallbackRecord(value: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") summary[key] = truncate(entry, MAX_FALLBACK_STRING_LENGTH);
    else if (typeof entry === "number" || typeof entry === "boolean") summary[key] = entry;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      summary[`${key}Count`] = entry.length;
      summary[key] = entry.slice(0, MAX_FALLBACK_ITEMS).map((item) =>
        isRecord(item) ? summarizeFallbackRecord(item) : item
      );
      if (entry.length > MAX_FALLBACK_ITEMS) {
        summary.omitted = `Only first ${MAX_FALLBACK_ITEMS} ${key} included`;
      }
      break;
    }
  }

  return Object.keys(summary).length > 0 ? summary : { keys: Object.keys(value).slice(0, 20) };
}

function summarizeFallback(result: unknown): { summary: unknown; status: ToolStatus } {
  if (Array.isArray(result)) {
    return {
      status: result.length === 0 ? "empty" : "success",
      summary: {
        itemsCount: result.length,
        items: result.slice(0, MAX_FALLBACK_ITEMS).map((item) =>
          isRecord(item) ? summarizeFallbackRecord(item) : item
        ),
        ...(result.length > MAX_FALLBACK_ITEMS
          ? { omitted: `Only first ${MAX_FALLBACK_ITEMS} items included` }
          : {}),
      },
    };
  }

  if (isRecord(result)) {
    if ("error" in result) {
      return { status: "error", summary: summarizeFallbackRecord(result) };
    }
    return { status: "success", summary: summarizeFallbackRecord(result) };
  }

  if (typeof result === "string") {
    return {
      status: result.length === 0 ? "empty" : "success",
      summary: truncate(result, MAX_FALLBACK_STRING_LENGTH),
    };
  }

  return { status: result == null ? "empty" : "success", summary: result };
}

export function summarizeToolResultForCurrentRunState(
  toolName: string,
  result: unknown,
): { summary: unknown; status: ToolStatus } {
  if (isRecord(result) && "error" in result) {
    return { status: "error", summary: summarizeFallbackRecord(result) };
  }

  const contract = historicalToolSummaries[toolName];
  if (contract) {
    const contracted = summarizeWithContract(result, contract);
    if (contracted) return contracted;
  }

  return summarizeFallback(result);
}

export function createCurrentRunToolState(): CurrentRunToolState {
  return {};
}

export function recordCurrentRunToolResult(
  state: CurrentRunToolState,
  input: RecordCurrentRunToolResultInput,
): void {
  const fingerprint = createToolInputFingerprint(input.input);
  const toolBucket = state[input.toolName] ?? { calls: {} };
  const existingCall = toolBucket.calls[fingerprint];
  const { summary, status } = summarizeToolResultForCurrentRunState(input.toolName, input.result);
  const evidence = NON_EVIDENCE_TOOL_NAMES.has(input.toolName)
    ? []
    : extractCurrentRunEvidence(input.result);

  toolBucket.calls[fingerprint] = {
    toolCallIds: existingCall?.toolCallIds.includes(input.toolCallId)
      ? existingCall.toolCallIds
      : [...(existingCall?.toolCallIds ?? []), input.toolCallId],
    input: input.input ?? {},
    status,
    summary,
    ...(evidence.length > 0 ? { evidence } : {}),
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  state[input.toolName] = toolBucket;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getToolCallInput(part: Record<string, unknown>): unknown {
  if (isRecord(part.args)) return part.args;
  if (isRecord(part.input)) return part.input;
  if (typeof part.args === "string") return parseJsonRecord(part.args) ?? part.args;
  if (typeof part.input === "string") return parseJsonRecord(part.input) ?? part.input;
  if (typeof part.inputText === "string") return parseJsonRecord(part.inputText) ?? part.inputText;
  return {};
}

function getToolResultValue(part: Record<string, unknown>): unknown {
  if ("result" in part) return part.result;
  if ("output" in part) return part.output;
  return undefined;
}

function getToolCallIdentity(
  part: unknown,
): { toolCallId: string; toolName: string } | null {
  if (!isRecord(part)) return null;

  const toolCallId = typeof part.toolCallId === "string"
    ? part.toolCallId
    : typeof part.tool_call_id === "string"
    ? part.tool_call_id
    : typeof part.id === "string"
    ? part.id
    : null;
  const toolName = typeof part.toolName === "string"
    ? part.toolName
    : typeof part.tool_name === "string"
    ? part.tool_name
    : typeof part.name === "string"
    ? part.name
    : null;

  return toolCallId && toolName ? { toolCallId, toolName } : null;
}

function isToolCallPart(part: unknown): part is Record<string, unknown> {
  if (!isRecord(part)) return false;
  const type = typeof part.type === "string" ? part.type : "";
  if (type === "tool-result" || type === "tool_result") return false;
  if (type === "tool-call" || type === "tool_call" || type.startsWith("tool-")) {
    return getToolCallIdentity(part) !== null;
  }
  return false;
}

function isToolResultLikePart(part: unknown): part is Record<string, unknown> {
  if (!isRecord(part)) return false;
  const type = typeof part.type === "string" ? part.type : "";
  if (type !== "tool-result" && type !== "tool_result") return false;
  return getToolCallIdentity(part) !== null && ("result" in part || "output" in part);
}

function isCurrentRunToolStateRuntimeContextPart(
  part: unknown,
): part is CurrentRunToolStateRuntimeContextPart {
  return isRecord(part) && part.type === "runtime-context" &&
    part.name === "current-run-tool-state" && isRecord(part.state);
}

function mergeCurrentRunToolState(target: CurrentRunToolState, source: CurrentRunToolState): void {
  for (const [toolName, bucket] of Object.entries(source)) {
    const targetBucket = target[toolName] ?? { calls: {} };
    for (const [fingerprint, call] of Object.entries(bucket.calls ?? {})) {
      const existing = targetBucket.calls[fingerprint];
      targetBucket.calls[fingerprint] = existing
        ? {
          ...call,
          toolCallIds: Array.from(new Set([...existing.toolCallIds, ...call.toolCallIds])),
        }
        : call;
    }
    target[toolName] = targetBucket;
  }
}

export function createCurrentRunToolStateRuntimeContextPart(
  state: CurrentRunToolState,
): CurrentRunToolStateRuntimeContextPart | null {
  return hasCurrentRunToolState(state)
    ? { type: "runtime-context", name: "current-run-tool-state", state }
    : null;
}

export function hydrateCurrentRunToolStateFromMessages(
  state: CurrentRunToolState,
  messages: readonly CurrentRunToolStateHydrationMessage[],
  options?: { now?: Date },
): void {
  const toolCallInputs = new Map<string, { toolName: string; input: unknown }>();

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (isCurrentRunToolStateRuntimeContextPart(part)) {
        mergeCurrentRunToolState(state, part.state);
        continue;
      }

      if (isToolCallPart(part)) {
        const identity = getToolCallIdentity(part);
        if (!identity) continue;
        toolCallInputs.set(identity.toolCallId, {
          toolName: identity.toolName,
          input: getToolCallInput(part),
        });
        continue;
      }

      if (!isToolResultLikePart(part)) continue;

      const identity = getToolCallIdentity(part);
      if (!identity) continue;
      const call = toolCallInputs.get(identity.toolCallId);
      recordCurrentRunToolResult(state, {
        toolCallId: identity.toolCallId,
        toolName: identity.toolName,
        input: call?.input ?? {},
        result: getToolResultValue(part),
        now: options?.now,
      });
    }
  }
}

export function hasCurrentRunToolState(state: CurrentRunToolState): boolean {
  return Object.keys(state).some((toolName) =>
    Object.keys(state[toolName]?.calls ?? {}).length > 0
  );
}

type PromptToolState = Record<
  string,
  {
    calls: Record<string, { status: ToolStatus; summary: unknown }>;
    semanticCalls?: Record<string, PromptSemanticToolCall>;
  }
>;

type PromptSemanticToolCall = {
  status: ToolStatus;
  callCount: number;
  parameters: Record<string, string>;
  summary: unknown;
};

type PromptRunState = {
  tools: PromptToolState;
  skills?: Record<
    string,
    {
      status: ToolStatus;
      callCount: number;
      source: string;
      summary: unknown;
    }
  >;
  actions?: Record<
    string,
    {
      status: ToolStatus;
      source: string;
      summary: unknown;
    }
  >;
};

function compactStringParameter(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function findRecordIdInStructuredContext(value: unknown): string | null {
  if (typeof value === "string") {
    return getRecordIds(value)[0] ?? null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecordIdInStructuredContext(item);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["record_id", "recordId", "entity_id", "entityId", "id"] as const) {
    const found = compactStringParameter(value[key]);
    if (found && getRecordIds(found).length > 0) return found;
  }

  for (const entry of Object.values(value)) {
    const found = findRecordIdInStructuredContext(entry);
    if (found) return found;
  }

  return null;
}

function getSemanticToolCall(input: {
  toolName: string;
  call: CurrentRunToolStateCall;
}): { key: string; parameters: Record<string, string> } | null {
  if (!isRecord(input.call.input)) return null;

  switch (input.toolName) {
    case "load_skill": {
      const skillId = compactStringParameter(input.call.input.skillId) ??
        compactStringParameter(input.call.input.skill_id);
      return skillId ? { key: `skill:${skillId}`, parameters: { skillId } } : null;
    }

    case "invoke_agent": {
      const agentId = compactStringParameter(input.call.input.agent_id) ??
        compactStringParameter(input.call.input.agentId);
      if (!agentId) return null;

      const stepId = compactStringParameter(input.call.input.step_id) ??
        compactStringParameter(input.call.input.stepId);
      const idempotencyKey = compactStringParameter(input.call.input.idempotency_key) ??
        compactStringParameter(input.call.input.idempotencyKey);
      const recordId = compactStringParameter(input.call.input.record_id) ??
        compactStringParameter(input.call.input.recordId) ??
        compactStringParameter(input.call.input.invoice_id) ??
        compactStringParameter(input.call.input.invoiceId) ??
        compactStringParameter(input.call.input.entity_id) ??
        compactStringParameter(input.call.input.entityId) ??
        findRecordIdInStructuredContext(input.call.input.context);
      const keySuffix = recordId
        ? `:record:${recordId}`
        : stepId
        ? `:step:${stepId}`
        : idempotencyKey
        ? `:idempotency:${idempotencyKey}`
        : "";
      const parameters: Record<string, string> = { agent_id: agentId };
      if (recordId) parameters.record_id = recordId;
      if (stepId) parameters.step_id = stepId;
      if (idempotencyKey) parameters.idempotency_key = idempotencyKey;
      return { key: `agent:${agentId}${keySuffix}`, parameters };
    }

    case "studio_todo_write": {
      const taskId = compactStringParameter(input.call.input.taskId) ??
        compactStringParameter(input.call.input.task_id);
      return taskId ? { key: `todo:${taskId}`, parameters: { taskId } } : null;
    }

    default:
      return null;
  }
}

function mergeSemanticToolCall(
  existing: PromptSemanticToolCall | undefined,
  call: CurrentRunToolStateCall,
  parameters: Record<string, string>,
): PromptSemanticToolCall {
  return {
    status: call.status,
    callCount: (existing?.callCount ?? 0) + call.toolCallIds.length,
    parameters: existing?.parameters ?? parameters,
    summary: call.summary,
  };
}

function usesSemanticPromptKeys(toolName: string): boolean {
  return toolName === "load_skill" ||
    toolName === "invoke_agent" ||
    toolName === "studio_todo_write";
}

function createPromptCallKey(input: {
  toolName: string;
  fingerprint: string;
  index: number;
}): string {
  return usesSemanticPromptKeys(input.toolName) ? `call:${input.index + 1}` : input.fingerprint;
}

export function projectCurrentRunToolStateForPrompt(
  state: CurrentRunToolState,
): PromptRunState {
  const tools: PromptToolState = {};
  const skills: NonNullable<PromptRunState["skills"]> = {};
  const actions: PromptRunState["actions"] = {};

  for (const [toolName, bucket] of Object.entries(state)) {
    const calls: PromptToolState[string]["calls"] = {};
    const semanticCalls: Record<string, PromptSemanticToolCall> = {};
    for (const [index, [fingerprint, call]] of Object.entries(bucket.calls).entries()) {
      calls[createPromptCallKey({ toolName, fingerprint, index })] = {
        status: call.status,
        summary: call.summary,
      };

      const semantic = getSemanticToolCall({ toolName, call });
      if (semantic) {
        const mergedSemanticCall = mergeSemanticToolCall(
          semanticCalls[semantic.key],
          call,
          semantic.parameters,
        );
        semanticCalls[semantic.key] = mergedSemanticCall;
        if (toolName === "load_skill" && semantic.parameters.skillId) {
          skills[semantic.parameters.skillId] = {
            status: mergedSemanticCall.status,
            callCount: mergedSemanticCall.callCount,
            source: `tools.${toolName}.semanticCalls.${semantic.key}`,
            summary: mergedSemanticCall.summary,
          };
        }
        actions[`${toolName}:${semantic.key}`] = {
          status: call.status,
          source: `tools.${toolName}.semanticCalls.${semantic.key}`,
          summary: call.summary,
        };
      }
    }

    if (Object.keys(calls).length > 0) {
      tools[toolName] = {
        calls,
        ...(Object.keys(semanticCalls).length > 0 ? { semanticCalls } : {}),
      };
    }
  }

  return {
    tools,
    ...(Object.keys(skills).length > 0 ? { skills } : {}),
    ...(Object.keys(actions).length > 0 ? { actions } : {}),
  };
}

export function appendCurrentRunToolStateToSystemPrompt(
  systemPrompt: string,
  state: CurrentRunToolState,
): string {
  if (!hasCurrentRunToolState(state)) return systemPrompt;

  const promptState = projectCurrentRunToolStateForPrompt(state);
  return `${systemPrompt}\n\n<run_state current_run=\"true\">\n${
    JSON.stringify(promptState)
  }\n</run_state>`;
}
