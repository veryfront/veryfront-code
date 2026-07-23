import type {
  EvalAnswerGroundednessMetricOptions,
  EvalKnowledgeCitationMetricOptions,
  EvalKnowledgeExpectedSource,
  EvalKnowledgeMrrMetricOptions,
  EvalKnowledgeRetrievalMetricOptions,
  EvalMetric,
  EvalMetricFamily,
  EvalMetricResult,
  EvalMetricThreshold,
  EvalRecord,
  EvalSeverity,
  EvalToolCallCountOptions,
  EvalToolCallMatchOptions,
} from "./types.ts";
import {
  evaluateCalledTool,
  evaluateNotCalledTool,
  evaluateToolCallCount,
  findEvalToolCalls,
  isEvalToolFailed,
} from "./tool-behavior.ts";
import { createEvalValidationError } from "./validation.ts";
import { canonicalJsonStringify } from "./canonical-json.ts";

type MetricEvaluator = (record: EvalRecord) => EvalMetricResult | Promise<EvalMetricResult>;

type KnowledgeEntry = {
  source: string;
  sourceCandidates: string[];
  contentCandidates: string[];
  evidenceCandidates: string[];
};

type CitationEntry = {
  source: string;
  sourceCandidates: string[];
  textCandidates: string[];
};

type CitationReferenceSet = {
  expected?: EvalKnowledgeExpectedSource[];
  expectedFrom?: string;
  retrieved: KnowledgeEntry[];
};

type JudgeRubricInput = {
  rubric: string;
  judge?: (input: {
    rubric: string;
    input: unknown;
    output: Record<string, unknown>;
    reference?: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<{ score: number; pass?: boolean; explanation?: string }>;
};

const DEFAULT_KNOWLEDGE_TOOL = "search_knowledge";
const DEFAULT_EXPECTED_KNOWLEDGE_PATH = "metadata.expectedKnowledge";
const DEFAULT_GROUNDEDNESS_RUBRIC =
  "Rate whether the answer is grounded in the retrieved evidence and avoids unsupported claims.";
const KNOWLEDGE_COLLECTION_KEYS = ["data", "matches", "results", "items", "chunks", "documents"];
const CITATION_COLLECTION_KEYS = ["citations", "sources", "references"];
const KNOWLEDGE_SOURCE_KEYS = [
  "path",
  "source",
  "id",
  "title",
  "name",
  "document_code",
  "documentCode",
  "url",
  "href",
];
const CITATION_TEXT_KEYS = ["text", "quote", "marker", "label", "content", "snippet", "excerpt"];
const KNOWLEDGE_CONTENT_KEYS = [
  "content",
  "text",
  "text_excerpt",
  "textExcerpt",
  "snippet",
  "excerpt",
  "chunk",
  "body",
  "verification_quote",
  "verificationQuote",
];
const KNOWLEDGE_MATCHED_FIELD_KEYS = ["matched_fields", "matchedFields"];
const EXPECTED_KNOWLEDGE_KEYS = new Set([
  "path",
  "source",
  "id",
  "title",
  "documentCode",
  "document_code",
  "contentMatch",
  "verificationQuote",
  "content",
  "text",
]);
const KNOWLEDGE_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "shall",
  "must",
  "will",
  "have",
  "been",
  "being",
  "their",
  "which",
  "into",
  "also",
  "each",
  "they",
  "such",
  "should",
  "would",
  "could",
]);

const MAX_METRIC_STRING_LENGTH = 16_384;
const MAX_KNOWLEDGE_RESULTS = 10_000;
const MAX_KNOWLEDGE_STRING_LENGTH = 1024 * 1024;
const MAX_KNOWLEDGE_TRAVERSAL_DEPTH = 32;
const MAX_KNOWLEDGE_COLLECTION_ENTRIES = 10_000;
const MAX_KNOWLEDGE_TRAVERSAL_NODES = 100_000;

function assertNonEmptyMetricString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createEvalValidationError(`${label} must be a non-empty string`);
  }
  if (value.length > MAX_METRIC_STRING_LENGTH) {
    throw createEvalValidationError(
      `${label} must not exceed ${MAX_METRIC_STRING_LENGTH} characters`,
    );
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw createEvalValidationError(`${label} must be a finite non-negative number`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createEvalValidationError(`${label} must be a non-negative safe integer`);
  }
}

function assertKnowledgeResultLimit(k: number, label = "Knowledge metric k"): void {
  if (!Number.isSafeInteger(k) || k < 1 || k > MAX_KNOWLEDGE_RESULTS) {
    throw createEvalValidationError(
      `${label} must be an integer between 1 and ${MAX_KNOWLEDGE_RESULTS}`,
    );
  }
}

function assertKnowledgeString(value: string, label: string): void {
  if (value.length > MAX_KNOWLEDGE_STRING_LENGTH) {
    throw createEvalValidationError(
      `${label} must not exceed ${MAX_KNOWLEDGE_STRING_LENGTH} characters`,
    );
  }
}

function assertKnowledgeOptions(
  options:
    | EvalKnowledgeRetrievalMetricOptions
    | EvalKnowledgeMrrMetricOptions
    | EvalKnowledgeCitationMetricOptions,
): void {
  for (
    const [label, value] of [
      ["knowledge tool", options.tool],
      ["expectedFrom", options.expectedFrom],
      ["citationsFrom", "citationsFrom" in options ? options.citationsFrom : undefined],
    ] as const
  ) {
    if (value !== undefined) assertNonEmptyMetricString(value, label);
  }
  if (options.expected !== undefined) {
    if (
      !Array.isArray(options.expected) ||
      options.expected.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES
    ) {
      throw createEvalValidationError(
        `Expected knowledge sources must contain at most ${MAX_KNOWLEDGE_COLLECTION_ENTRIES} entries`,
      );
    }
    for (const entry of options.expected) {
      if (typeof entry === "string") {
        if (entry.trim().length === 0) {
          throw createEvalValidationError("Expected knowledge source must not be empty");
        }
        assertKnowledgeString(entry, "Expected knowledge source");
      } else if (isRecord(entry)) {
        let meaningfulFields = 0;
        for (const [key, value] of Object.entries(entry)) {
          if (!EXPECTED_KNOWLEDGE_KEYS.has(key)) {
            throw createEvalValidationError(`Unknown expected knowledge source field "${key}"`);
          }
          if (value !== undefined && typeof value !== "string") {
            throw createEvalValidationError("Expected knowledge source fields must be strings");
          }
          if (typeof value === "string") {
            if (value.trim().length === 0) continue;
            meaningfulFields += 1;
            assertKnowledgeString(value, "Expected knowledge source field");
          }
        }
        if (meaningfulFields === 0) {
          throw createEvalValidationError(
            "Expected knowledge source object must contain a non-empty supported field",
          );
        }
      } else {
        throw createEvalValidationError(
          "Expected knowledge sources must be strings or source objects",
        );
      }
    }
  }
}

function assertMetricThreshold(threshold: EvalMetricThreshold | undefined): void {
  if (!threshold) return;
  if (threshold.min !== undefined && !Number.isFinite(threshold.min)) {
    throw createEvalValidationError("Metric threshold min must be finite");
  }
  if (threshold.max !== undefined && !Number.isFinite(threshold.max)) {
    throw createEvalValidationError("Metric threshold max must be finite");
  }
  if (
    threshold.min !== undefined && threshold.max !== undefined && threshold.min > threshold.max
  ) {
    throw createEvalValidationError("Metric threshold min must not exceed max");
  }
}

function assertToolName(name: string): void {
  assertNonEmptyMetricString(name, "Tool name");
}

function assertToolCallCountOptions(options: EvalToolCallCountOptions): void {
  const configured = [options.exact, options.min, options.max].filter((value) =>
    value !== undefined
  );
  if (configured.length === 0) {
    throw createEvalValidationError(
      "Tool call count must configure exact, min, or max",
    );
  }
  if (options.exact !== undefined && (options.min !== undefined || options.max !== undefined)) {
    throw createEvalValidationError("Tool call count exact cannot be combined with min or max");
  }
  for (const [label, value] of Object.entries(options)) {
    if (value !== undefined) assertNonNegativeInteger(value, `Tool call count ${label}`);
  }
  if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
    throw createEvalValidationError("Tool call count min must not exceed max");
  }
}

function getOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.output === "string") return record.output;
  }
  try {
    return stableStringify(output) ?? String(output);
  } catch {
    return String(output);
  }
}

function getOutputJson(output: unknown): unknown {
  if (output && typeof output === "object" && "json" in output) {
    return (output as { json: unknown }).json;
  }
  return output;
}

function stableStringify(value: unknown): string {
  return canonicalJsonStringify(value) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    return current[segment];
  }, value);
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase().replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalizeComparable(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(value);
  }
  return unique;
}

function collectStringField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) return [];
  assertKnowledgeString(value, `Knowledge field ${key}`);
  return [value];
}

function collectLeafStrings(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
  state: { nodes: number } = { nodes: 0 },
): string[] {
  state.nodes += 1;
  if (state.nodes > MAX_KNOWLEDGE_TRAVERSAL_NODES) {
    throw createEvalValidationError("Knowledge metadata contains too many values");
  }
  if (depth > MAX_KNOWLEDGE_TRAVERSAL_DEPTH) {
    throw createEvalValidationError(
      `Knowledge metadata must not exceed ${MAX_KNOWLEDGE_TRAVERSAL_DEPTH} levels`,
    );
  }
  if (typeof value === "string") {
    assertKnowledgeString(value, "Knowledge metadata string");
    return value.trim() ? [value] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) {
    if (value.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
      throw createEvalValidationError("Knowledge metadata collection is too large");
    }
    if (seen.has(value)) throw createEvalValidationError("Knowledge metadata must not be cyclic");
    seen.add(value);
    try {
      return value.flatMap((entry) => collectLeafStrings(entry, depth + 1, seen, state));
    } finally {
      seen.delete(value);
    }
  }
  if (!isRecord(value)) return [];
  const entries = Object.values(value);
  if (entries.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
    throw createEvalValidationError("Knowledge metadata object has too many fields");
  }
  if (seen.has(value)) throw createEvalValidationError("Knowledge metadata must not be cyclic");
  seen.add(value);
  try {
    return entries.flatMap((entry) => collectLeafStrings(entry, depth + 1, seen, state));
  } finally {
    seen.delete(value);
  }
}

function collectFrontmatterValues(value: unknown): string[] {
  if (!Array.isArray(value)) return collectLeafStrings(value);
  if (value.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
    throw createEvalValidationError("Knowledge frontmatter collection is too large");
  }

  const values: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      values.push(...collectLeafStrings(entry));
      continue;
    }
    const fieldValue = entry.value;
    if (typeof fieldValue === "string" && fieldValue.trim()) {
      assertKnowledgeString(fieldValue, "Knowledge frontmatter value");
      values.push(fieldValue);
    }
  }
  return values;
}

function formatFrontmatterEvidence(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (value.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
      throw createEvalValidationError("Knowledge frontmatter collection is too large");
    }
    const pairs = value.flatMap((entry) => {
      if (!isRecord(entry)) return collectLeafStrings(entry);
      const key = typeof entry.key === "string" && entry.key.trim() ? `${entry.key}: ` : "";
      return collectLeafStrings(entry.value).map((fieldValue) => `${key}${fieldValue}`);
    });
    return pairs.length > 0 ? [`frontmatter: ${pairs.join("; ")}`] : [];
  }

  if (isRecord(value)) {
    if (Object.keys(value).length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
      throw createEvalValidationError("Knowledge frontmatter object has too many fields");
    }
    const pairs = Object.entries(value).flatMap(([key, fieldValue]) =>
      collectLeafStrings(fieldValue).map((item) => `${key}: ${item}`)
    );
    return pairs.length > 0 ? [`frontmatter: ${pairs.join("; ")}`] : [];
  }

  const values = collectLeafStrings(value);
  return values.length > 0 ? [`frontmatter: ${values.join("; ")}`] : [];
}

function collectCompactEvidence(item: Record<string, unknown>): string[] {
  const matchedFields = KNOWLEDGE_MATCHED_FIELD_KEYS.flatMap((key) =>
    collectLeafStrings(item[key])
  );
  return [
    ...(matchedFields.length > 0 ? [`matched_fields: ${matchedFields.join("; ")}`] : []),
    ...formatFrontmatterEvidence(item.frontmatter),
  ];
}

function extractKnowledgeItems(output: unknown): unknown[] {
  if (Array.isArray(output)) {
    if (output.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
      throw createEvalValidationError("Knowledge result collection is too large");
    }
    return output;
  }
  if (!isRecord(output)) return [];

  for (const key of KNOWLEDGE_COLLECTION_KEYS) {
    const value = output[key];
    if (Array.isArray(value)) {
      if (value.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
        throw createEvalValidationError("Knowledge result collection is too large");
      }
      return value;
    }
  }

  return KNOWLEDGE_SOURCE_KEYS.some((key) => typeof output[key] === "string") ? [output] : [];
}

function createKnowledgeEntry(item: unknown): KnowledgeEntry | null {
  if (!isRecord(item)) {
    if (typeof item === "string" && item.trim()) {
      assertKnowledgeString(item, "Knowledge result");
      return {
        source: item,
        sourceCandidates: [item],
        contentCandidates: [item],
        evidenceCandidates: [item],
      };
    }
    return null;
  }

  const sourceCandidates = uniqueStrings([
    ...KNOWLEDGE_SOURCE_KEYS.flatMap((key) => collectStringField(item, key)),
    ...collectFrontmatterValues(item.frontmatter),
  ]);
  const contentCandidates = uniqueStrings(
    KNOWLEDGE_CONTENT_KEYS.flatMap((key) => collectStringField(item, key)),
  );
  const source = sourceCandidates[0] ?? contentCandidates[0] ?? stableStringify(item);
  assertKnowledgeString(source, "Knowledge source");
  const evidenceCandidates = uniqueStrings([
    ...contentCandidates,
    ...collectCompactEvidence(item),
  ]);

  return {
    source,
    sourceCandidates: sourceCandidates.length === 0 ? [source] : sourceCandidates,
    contentCandidates,
    evidenceCandidates: evidenceCandidates.length === 0 ? [source] : evidenceCandidates,
  };
}

function getKnowledgeEntries(record: EvalRecord, tool = DEFAULT_KNOWLEDGE_TOOL): KnowledgeEntry[] {
  if ((record.retrievedContext?.length ?? 0) > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
    throw createEvalValidationError("Retrieved knowledge context is too large");
  }
  const explicitEntries = (record.retrievedContext ?? [])
    .map(createKnowledgeEntry)
    .filter((entry): entry is KnowledgeEntry => entry !== null);
  if (explicitEntries.length > 0) return explicitEntries;

  const entries: KnowledgeEntry[] = [];
  for (const call of findEvalToolCalls(record, tool)) {
    if (isEvalToolFailed(call)) continue;
    for (const item of extractKnowledgeItems(call.output)) {
      const entry = createKnowledgeEntry(item);
      if (!entry) continue;
      if (entries.length >= MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
        throw createEvalValidationError("Knowledge results contain too many entries");
      }
      entries.push(entry);
    }
  }
  return entries;
}

function extractCitationItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    if (value.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
      throw createEvalValidationError("Citation collection is too large");
    }
    return value;
  }
  if (!isRecord(value)) return [];

  for (const key of CITATION_COLLECTION_KEYS) {
    const citations = value[key];
    if (Array.isArray(citations)) {
      if (citations.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
        throw createEvalValidationError("Citation collection is too large");
      }
      return citations;
    }
  }

  return KNOWLEDGE_SOURCE_KEYS.some((key) => typeof value[key] === "string") ? [value] : [];
}

function createCitationEntry(item: unknown): CitationEntry | null {
  if (!isRecord(item)) {
    if (typeof item === "string" && item.trim()) {
      assertKnowledgeString(item, "Citation");
      return {
        source: item,
        sourceCandidates: [item],
        textCandidates: [item],
      };
    }
    return null;
  }

  const sourceCandidates = uniqueStrings(
    KNOWLEDGE_SOURCE_KEYS.flatMap((key) => collectStringField(item, key)),
  );
  const textCandidates = uniqueStrings(
    CITATION_TEXT_KEYS.flatMap((key) => collectStringField(item, key)),
  );
  const source = sourceCandidates[0] ?? textCandidates[0] ?? stableStringify(item);
  assertKnowledgeString(source, "Citation source");
  return {
    source,
    sourceCandidates: sourceCandidates.length === 0 ? [source] : sourceCandidates,
    textCandidates,
  };
}

function getCitationEntries(
  record: EvalRecord,
  options: EvalKnowledgeCitationMetricOptions,
): CitationEntry[] {
  if (options.citationsFrom) {
    return extractCitationItems(getPathValue(record, options.citationsFrom))
      .map(createCitationEntry)
      .filter((entry): entry is CitationEntry => entry !== null);
  }

  if ((record.citations?.length ?? 0) > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
    throw createEvalValidationError("Citation collection is too large");
  }

  const explicitCitations = (record.citations ?? [])
    .map(createCitationEntry)
    .filter((entry): entry is CitationEntry => entry !== null);
  if (explicitCitations.length > 0) return explicitCitations;

  return extractCitationItems(record.output)
    .map(createCitationEntry)
    .filter((entry): entry is CitationEntry => entry !== null);
}

function expectedSourceLabel(expected: EvalKnowledgeExpectedSource): string {
  if (typeof expected === "string") return expected;
  return expected.path ?? expected.source ?? expected.documentCode ?? expected.document_code ??
    expected.id ?? expected.title ?? expected.contentMatch ?? expected.verificationQuote ??
    expected.content ?? expected.text ?? stableStringify(expected);
}

function normalizeExpectedKnowledgeSources(value: unknown): EvalKnowledgeExpectedSource[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length > MAX_KNOWLEDGE_COLLECTION_ENTRIES) {
    throw createEvalValidationError("Expected knowledge collection is too large");
  }
  return values.filter((entry): entry is EvalKnowledgeExpectedSource => {
    if (typeof entry === "string") return entry.trim().length > 0;
    if (!isRecord(entry)) return false;
    return Object.keys(entry).length > 0;
  });
}

function resolveExpectedKnowledgeSources(
  record: EvalRecord,
  options: EvalKnowledgeRetrievalMetricOptions | EvalKnowledgeMrrMetricOptions,
): {
  expected: EvalKnowledgeExpectedSource[];
  expectedFrom?: string;
} {
  if (options.expected) return { expected: options.expected };

  const expectedFrom = options.expectedFrom ?? DEFAULT_EXPECTED_KNOWLEDGE_PATH;
  const expected = normalizeExpectedKnowledgeSources(getPathValue(record, expectedFrom));
  assertKnowledgeOptions({ ...options, expected });
  return {
    expected,
    expectedFrom,
  };
}

function createKnowledgeMetricConfig(
  options:
    | EvalKnowledgeRetrievalMetricOptions
    | EvalKnowledgeMrrMetricOptions
    | EvalKnowledgeCitationMetricOptions,
): Record<string, unknown> {
  return {
    ...options,
    ...(!options.expected
      ? { expectedFrom: options.expectedFrom ?? DEFAULT_EXPECTED_KNOWLEDGE_PATH }
      : {}),
  };
}

function resolveCitationReferenceSet(
  record: EvalRecord,
  options: EvalKnowledgeCitationMetricOptions,
): CitationReferenceSet {
  const expectedResult = resolveExpectedKnowledgeSources(record, options);
  if (expectedResult.expected.length > 0) {
    return {
      expected: expectedResult.expected,
      ...(expectedResult.expectedFrom ? { expectedFrom: expectedResult.expectedFrom } : {}),
      retrieved: [],
    };
  }

  const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
  const allEntries = getKnowledgeEntries(record, tool);
  const retrieved = options.k === undefined ? allEntries : allEntries.slice(0, options.k);
  return { retrieved };
}

function citationLabels(citations: CitationEntry[]): string[] {
  return citations.map((citation) => citation.source);
}

function citationMatchesExpected(
  expected: EvalKnowledgeExpectedSource,
  citation: CitationEntry,
): boolean {
  if (typeof expected === "string") {
    return matchesStringCandidate(expected, citation.sourceCandidates);
  }

  const sourceExpectations = [
    expected.path,
    expected.source,
    expected.id,
    expected.title,
    expected.documentCode,
    expected.document_code,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (sourceExpectations.length > 0) {
    return sourceExpectations.some((value) =>
      matchesStringCandidate(value, citation.sourceCandidates)
    );
  }

  const contentExpectations = [
    expected.contentMatch,
    expected.verificationQuote,
    expected.content,
    expected.text,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return contentExpectations.some((value) => matchesContent(value, citation.textCandidates));
}

function citationMatchesKnowledgeEntry(citation: CitationEntry, entry: KnowledgeEntry): boolean {
  return citation.sourceCandidates.some((candidate) =>
    matchesStringCandidate(candidate, entry.sourceCandidates)
  );
}

function citationIsSupported(
  citation: CitationEntry,
  references: CitationReferenceSet,
): boolean {
  if (references.expected && references.expected.length > 0) {
    return references.expected.some((expected) => citationMatchesExpected(expected, citation));
  }
  return references.retrieved.some((entry) => citationMatchesKnowledgeEntry(citation, entry));
}

function referenceLabels(references: CitationReferenceSet): string[] {
  if (references.expected && references.expected.length > 0) {
    return references.expected.map(expectedSourceLabel);
  }
  return retrievedSources(references.retrieved);
}

function missingCitationReferencesResult(
  name: string,
  tool: string,
  citations: CitationEntry[],
): EvalMetricResult {
  return {
    name,
    family: "knowledge",
    severity: "gate",
    skipped: true,
    explanation: "No expected or retrieved knowledge sources were available for citation scoring.",
    evidence: {
      tool,
      citations: citationLabels(citations),
    },
  };
}

function missingCitationResult(
  name: string,
  tool: string,
  references: CitationReferenceSet,
): EvalMetricResult {
  return {
    name,
    family: "knowledge",
    severity: "gate",
    score: 0,
    pass: false,
    explanation: "No structured citations were found on the eval record.",
    evidence: {
      tool,
      citations: [],
      ...(references.expected && references.expected.length > 0
        ? {
          expected: references.expected.map(expectedSourceLabel),
          ...(references.expectedFrom ? { expectedFrom: references.expectedFrom } : {}),
        }
        : { retrieved: retrievedSources(references.retrieved) }),
    },
  };
}

function missingExpectedKnowledgeResult(
  name: string,
  tool: string,
  expectedFrom: string | undefined,
  entries: KnowledgeEntry[],
  k: number,
): EvalMetricResult {
  return {
    name,
    family: "knowledge",
    severity: "gate",
    skipped: true,
    explanation: expectedFrom
      ? `No expected knowledge sources found at ${expectedFrom}.`
      : "No expected knowledge sources were configured.",
    evidence: {
      tool,
      k,
      retrieved: retrievedSources(entries),
      ...(expectedFrom ? { expectedFrom } : {}),
    },
  };
}

function matchesStringCandidate(expected: string, candidates: string[]): boolean {
  const normalizedExpected = normalizeComparable(expected);
  return candidates.some((candidate) => normalizeComparable(candidate) === normalizedExpected);
}

function significantWords(value: string): string[] {
  return [...value.toLowerCase().matchAll(/\b[a-z0-9]{4,}\b/g)]
    .map((match) => match[0])
    .filter((word) => !KNOWLEDGE_STOP_WORDS.has(word))
    .slice(0, 12);
}

function matchesContent(expected: string, candidates: string[]): boolean {
  const normalizedExpected = normalizeComparable(expected);
  if (candidates.some((candidate) => normalizeComparable(candidate).includes(normalizedExpected))) {
    return true;
  }

  const words = significantWords(expected);
  if (words.length === 0) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeComparable(candidate);
    const matches = words.filter((word) => normalizedCandidate.includes(word)).length;
    return matches / words.length >= 0.6;
  });
}

function expectedMatchesEntry(
  expected: EvalKnowledgeExpectedSource,
  entry: KnowledgeEntry,
): boolean {
  if (typeof expected === "string") return matchesStringCandidate(expected, entry.sourceCandidates);

  const sourceExpectations = [
    expected.path,
    expected.source,
    expected.id,
    expected.title,
    expected.documentCode,
    expected.document_code,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const contentExpectations = [
    expected.contentMatch,
    expected.verificationQuote,
    expected.content,
    expected.text,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const sourceMatched = sourceExpectations.length === 0 ||
    sourceExpectations.some((value) => matchesStringCandidate(value, entry.sourceCandidates));
  const contentMatched = contentExpectations.length === 0 ||
    contentExpectations.some((value) => matchesContent(value, entry.contentCandidates));

  return sourceMatched && contentMatched;
}

function findMatchedExpectedSources(
  entries: KnowledgeEntry[],
  expected: EvalKnowledgeExpectedSource[],
): string[] {
  return expected
    .filter((source) => entries.some((entry) => expectedMatchesEntry(source, entry)))
    .map(expectedSourceLabel);
}

function retrievedSources(entries: KnowledgeEntry[]): string[] {
  return entries.map((entry) => entry.source);
}

function withSeverity(
  metric: Omit<EvalMetric, "gate" | "soft" | "budget">,
  severity: EvalSeverity,
  threshold?: EvalMetricThreshold,
): EvalMetric {
  assertMetricThreshold(threshold);
  const normalizedThreshold = threshold ? { ...threshold } : undefined;
  const base = {
    ...metric,
    severity,
    ...(normalizedThreshold ? { threshold: { ...normalizedThreshold } } : {}),
  };
  return {
    ...base,
    async evaluate(record, context) {
      const result = await metric.evaluate(record, context);
      const next = {
        ...result,
        name: metric.name,
        family: metric.family,
        severity,
      };
      if (!normalizedThreshold || result.skipped || typeof next.score !== "number") {
        return next;
      }

      const minPass = normalizedThreshold.min === undefined ||
        next.score >= normalizedThreshold.min;
      const maxPass = normalizedThreshold.max === undefined ||
        next.score <= normalizedThreshold.max;
      const thresholdPass = minPass && maxPass;
      return {
        ...next,
        pass: next.pass === undefined ? thresholdPass : next.pass && thresholdPass,
      };
    },
    gate(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "gate", nextThreshold ?? normalizedThreshold);
    },
    soft(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "soft", nextThreshold ?? normalizedThreshold);
    },
    budget(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "budget", nextThreshold ?? normalizedThreshold);
    },
  };
}

function createMetric(
  name: string,
  family: EvalMetricFamily,
  evaluator: MetricEvaluator,
  config?: Record<string, unknown>,
): EvalMetric {
  const metric = {
    name,
    family,
    severity: "gate" as const,
    ...(config ? { config } : {}),
    async evaluate(record: EvalRecord): Promise<EvalMetricResult> {
      const result = await evaluator(record);
      return {
        ...result,
        name,
        family,
        severity: "gate",
      };
    },
  };

  return withSeverity(metric, "gate");
}

function createKnowledgeMetric(
  name: string,
  evaluator: MetricEvaluator,
  config: Record<string, unknown>,
): EvalMetric {
  return createMetric(name, "knowledge", evaluator, config).gate({ min: 1 });
}

function scoreResult(
  name: string,
  family: EvalMetricFamily,
  severity: EvalSeverity,
  pass: boolean,
  score = pass ? 1 : 0,
): EvalMetricResult {
  return { name, family, severity, score, pass };
}

/** Metric factories for deterministic answers, agent behavior, operations, and judges. */
export const metrics = {
  answer: {
    exactMatch(): EvalMetric {
      return createMetric("answer.exactMatch", "answer", (record) => {
        const pass = getOutputText(record.output) === getOutputText(record.reference);
        return scoreResult("answer.exactMatch", "answer", "gate", pass);
      });
    },

    contains(options: { text: string; caseSensitive?: boolean }): EvalMetric {
      assertNonEmptyMetricString(options.text, "Answer contains text");
      return createMetric("answer.contains", "answer", (record) => {
        const actual = getOutputText(record.output);
        const expected = options.text;
        const pass = options.caseSensitive
          ? actual.includes(expected)
          : actual.toLowerCase().includes(expected.toLowerCase());
        return scoreResult("answer.contains", "answer", "gate", pass);
      }, options);
    },

    regex(options: { pattern: string; flags?: string }): EvalMetric {
      assertNonEmptyMetricString(options.pattern, "Answer regex pattern");
      if (options.flags !== undefined && options.flags.length > 32) {
        throw createEvalValidationError("Answer regex flags must not exceed 32 characters");
      }
      const pattern = new RegExp(options.pattern, options.flags);
      return createMetric("answer.regex", "answer", (record) => {
        pattern.lastIndex = 0;
        return scoreResult(
          "answer.regex",
          "answer",
          "gate",
          pattern.test(getOutputText(record.output)),
        );
      }, options);
    },

    jsonMatch(options: { expected?: unknown }): EvalMetric {
      return createMetric("answer.jsonMatch", "answer", (record) => {
        const expected = Object.hasOwn(options, "expected") ? options.expected : record.reference;
        const actual = getOutputJson(record.output);
        let pass = false;
        try {
          pass = stableStringify(actual) === stableStringify(expected);
        } catch {
          pass = false;
        }
        return scoreResult("answer.jsonMatch", "answer", "gate", pass);
      }, options as Record<string, unknown>);
    },

    groundedness(options: EvalAnswerGroundednessMetricOptions = {}): EvalMetric {
      if (options.tool !== undefined) assertNonEmptyMetricString(options.tool, "Knowledge tool");
      if (options.rubric !== undefined) assertNonEmptyMetricString(options.rubric, "Rubric");
      return createMetric("answer.groundedness", "answer", async (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const entries = getKnowledgeEntries(record, tool);
        const evidence = uniqueStrings(entries.flatMap((entry) => entry.evidenceCandidates));
        const sources = uniqueStrings(retrievedSources(entries));

        if (!options.judge) {
          return {
            name: "answer.groundedness",
            family: "answer",
            severity: "gate",
            skipped: true,
            explanation: "No groundedness judge function was provided.",
            evidence: { tool, evidenceCount: evidence.length, sources },
          };
        }

        const output = isRecord(record.output)
          ? record.output
          : { text: getOutputText(record.output) };
        const judged: unknown = await options.judge({
          rubric: options.rubric ?? DEFAULT_GROUNDEDNESS_RUBRIC,
          input: record.input,
          output,
          reference: record.reference,
          metadata: record.metadata,
          evidence,
          sources,
        });

        const scoreIsValid = isRecord(judged) && typeof judged.score === "number" &&
          Number.isFinite(judged.score) && judged.score >= 0 && judged.score <= 1 &&
          (judged.pass === undefined || typeof judged.pass === "boolean") &&
          (judged.explanation === undefined || typeof judged.explanation === "string");
        if (!scoreIsValid) {
          return {
            name: "answer.groundedness",
            family: "answer",
            severity: "gate",
            score: 0,
            pass: false,
            explanation: "Groundedness judge returned an invalid score.",
            evidence: { tool, evidenceCount: evidence.length, sources },
          };
        }

        return {
          name: "answer.groundedness",
          family: "answer",
          severity: "gate",
          score: judged.score as number,
          pass: (judged.pass as boolean | undefined) ?? (judged.score as number) > 0,
          ...(judged.explanation ? { explanation: judged.explanation as string } : {}),
          evidence: { tool, evidenceCount: evidence.length, sources },
        };
      }, {
        ...(options.tool ? { tool: options.tool } : {}),
        rubric: options.rubric ?? DEFAULT_GROUNDEDNESS_RUBRIC,
      });
    },
  },

  agent: {
    noFailedTools(): EvalMetric {
      return createMetric("agent.noFailedTools", "agent", (record) => {
        const failedTools = record.trace.toolCalls.filter(isEvalToolFailed).map((tool) =>
          tool.name
        );
        return {
          name: "agent.noFailedTools",
          family: "agent",
          severity: "gate",
          score: failedTools.length === 0 ? 1 : 0,
          pass: failedTools.length === 0,
          ...(failedTools.length > 0 ? { evidence: { failedTools } } : {}),
        };
      });
    },

    calledTool(name: string, options?: EvalToolCallMatchOptions): EvalMetric {
      assertToolName(name);
      return createMetric(
        "agent.calledTool",
        "agent",
        (record) => ({
          name: "agent.calledTool",
          family: "agent",
          severity: "gate",
          ...evaluateCalledTool(record, name, options),
        }),
        { tool: name, ...(options ?? {}) },
      );
    },

    notCalledTool(name: string): EvalMetric {
      assertToolName(name);
      return createMetric(
        "agent.notCalledTool",
        "agent",
        (record) => ({
          name: "agent.notCalledTool",
          family: "agent",
          severity: "gate",
          ...evaluateNotCalledTool(record, name),
        }),
        { tool: name },
      );
    },

    toolCallCount(name: string, options: EvalToolCallCountOptions): EvalMetric {
      assertToolName(name);
      assertToolCallCountOptions(options);
      return createMetric(
        "agent.toolCallCount",
        "agent",
        (record) => ({
          name: "agent.toolCallCount",
          family: "agent",
          severity: "gate",
          ...evaluateToolCallCount(record, name, options),
        }),
        { tool: name, ...options },
      );
    },
  },

  knowledge: {
    recallAtK(options: EvalKnowledgeRetrievalMetricOptions): EvalMetric {
      assertKnowledgeResultLimit(options.k);
      assertKnowledgeOptions(options);
      return createKnowledgeMetric("knowledge.recallAtK", (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const entries = getKnowledgeEntries(record, tool).slice(0, options.k);
        const { expected, expectedFrom } = resolveExpectedKnowledgeSources(record, options);
        if (expected.length === 0) {
          return missingExpectedKnowledgeResult(
            "knowledge.recallAtK",
            tool,
            expectedFrom,
            entries,
            options.k,
          );
        }

        const found = findMatchedExpectedSources(entries, expected);
        const score = found.length / expected.length;
        return {
          name: "knowledge.recallAtK",
          family: "knowledge",
          severity: "gate",
          score,
          evidence: {
            tool,
            k: options.k,
            retrieved: retrievedSources(entries),
            expected: expected.map(expectedSourceLabel),
            ...(expectedFrom ? { expectedFrom } : {}),
            found,
            foundCount: found.length,
            expectedCount: expected.length,
          },
        };
      }, createKnowledgeMetricConfig(options));
    },

    precisionAtK(options: EvalKnowledgeRetrievalMetricOptions): EvalMetric {
      assertKnowledgeResultLimit(options.k);
      assertKnowledgeOptions(options);
      return createKnowledgeMetric("knowledge.precisionAtK", (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const entries = getKnowledgeEntries(record, tool).slice(0, options.k);
        const { expected, expectedFrom } = resolveExpectedKnowledgeSources(record, options);
        if (expected.length === 0) {
          return missingExpectedKnowledgeResult(
            "knowledge.precisionAtK",
            tool,
            expectedFrom,
            entries,
            options.k,
          );
        }

        const relevantEntries = entries.filter((entry) =>
          expected.some((source) => expectedMatchesEntry(source, entry))
        );
        const retrievedCount = entries.length;
        const score = retrievedCount === 0 ? 0 : relevantEntries.length / retrievedCount;
        return {
          name: "knowledge.precisionAtK",
          family: "knowledge",
          severity: "gate",
          score,
          evidence: {
            tool,
            k: options.k,
            retrieved: retrievedSources(entries),
            expected: expected.map(expectedSourceLabel),
            ...(expectedFrom ? { expectedFrom } : {}),
            relevant: retrievedSources(relevantEntries),
            relevantCount: relevantEntries.length,
            retrievedCount,
          },
        };
      }, createKnowledgeMetricConfig(options));
    },

    mrr(options: EvalKnowledgeMrrMetricOptions): EvalMetric {
      if (options.k !== undefined) assertKnowledgeResultLimit(options.k);
      assertKnowledgeOptions(options);
      return createKnowledgeMetric("knowledge.mrr", (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const allEntries = getKnowledgeEntries(record, tool);
        const k = options.k ?? allEntries.length;
        const entries = allEntries.slice(0, k);
        const { expected, expectedFrom } = resolveExpectedKnowledgeSources(record, options);
        if (expected.length === 0) {
          return missingExpectedKnowledgeResult(
            "knowledge.mrr",
            tool,
            expectedFrom,
            entries,
            k,
          );
        }

        const index = entries.findIndex((entry) =>
          expected.some((source) => expectedMatchesEntry(source, entry))
        );
        const rank = index === -1 ? null : index + 1;
        const score = rank === null ? 0 : 1 / rank;
        return {
          name: "knowledge.mrr",
          family: "knowledge",
          severity: "gate",
          score,
          evidence: {
            tool,
            k,
            retrieved: retrievedSources(entries),
            expected: expected.map(expectedSourceLabel),
            ...(expectedFrom ? { expectedFrom } : {}),
            ...(rank === null ? {} : {
              rank,
              match: entries[index]?.source,
            }),
          },
        };
      }, createKnowledgeMetricConfig(options));
    },

    citationPrecision(options: EvalKnowledgeCitationMetricOptions = {}): EvalMetric {
      if (options.k !== undefined) assertKnowledgeResultLimit(options.k);
      assertKnowledgeOptions(options);
      return createKnowledgeMetric("knowledge.citationPrecision", (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const citations = getCitationEntries(record, options);
        const references = resolveCitationReferenceSet(record, options);
        const labels = referenceLabels(references);
        if (labels.length === 0) {
          return missingCitationReferencesResult("knowledge.citationPrecision", tool, citations);
        }
        if (citations.length === 0) {
          return missingCitationResult("knowledge.citationPrecision", tool, references);
        }

        const supportedCitations = citations.filter((citation) =>
          citationIsSupported(citation, references)
        );
        const unsupportedCitations = citations.filter((citation) =>
          !citationIsSupported(citation, references)
        );
        return {
          name: "knowledge.citationPrecision",
          family: "knowledge",
          severity: "gate",
          score: supportedCitations.length / citations.length,
          evidence: {
            tool,
            citations: citationLabels(citations),
            ...(references.expected && references.expected.length > 0
              ? {
                expected: references.expected.map(expectedSourceLabel),
                ...(references.expectedFrom ? { expectedFrom: references.expectedFrom } : {}),
              }
              : { retrieved: retrievedSources(references.retrieved) }),
            supported: citationLabels(supportedCitations),
            unsupported: citationLabels(unsupportedCitations),
            supportedCount: supportedCitations.length,
            citationCount: citations.length,
          },
        };
      }, createKnowledgeMetricConfig(options));
    },

    citationRecall(options: EvalKnowledgeCitationMetricOptions = {}): EvalMetric {
      if (options.k !== undefined) assertKnowledgeResultLimit(options.k);
      assertKnowledgeOptions(options);
      return createKnowledgeMetric("knowledge.citationRecall", (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const citations = getCitationEntries(record, options);
        const references = resolveCitationReferenceSet(record, options);
        const labels = referenceLabels(references);
        if (labels.length === 0) {
          return missingCitationReferencesResult("knowledge.citationRecall", tool, citations);
        }
        if (citations.length === 0) {
          return missingCitationResult("knowledge.citationRecall", tool, references);
        }

        const cited = references.expected && references.expected.length > 0
          ? references.expected
            .filter((expected) =>
              citations.some((citation) => citationMatchesExpected(expected, citation))
            )
            .map(expectedSourceLabel)
          : references.retrieved
            .filter((entry) =>
              citations.some((citation) => citationMatchesKnowledgeEntry(citation, entry))
            )
            .map((entry) => entry.source);
        const missing = labels.filter((label) =>
          !cited.some((citedLabel) =>
            normalizeComparable(citedLabel) === normalizeComparable(label)
          )
        );

        return {
          name: "knowledge.citationRecall",
          family: "knowledge",
          severity: "gate",
          score: cited.length / labels.length,
          evidence: {
            tool,
            citations: citationLabels(citations),
            ...(references.expected && references.expected.length > 0
              ? {
                expected: references.expected.map(expectedSourceLabel),
                ...(references.expectedFrom ? { expectedFrom: references.expectedFrom } : {}),
              }
              : { retrieved: retrievedSources(references.retrieved) }),
            cited,
            missing,
            citedCount: cited.length,
            expectedCount: labels.length,
          },
        };
      }, createKnowledgeMetricConfig(options));
    },
  },

  ops: {
    latency(options: { maxMs: number }): EvalMetric {
      assertFiniteNonNegative(options.maxMs, "Latency maxMs");
      return createMetric("ops.latency", "ops", (record) => {
        const pass = record.durationMs <= options.maxMs;
        return {
          name: "ops.latency",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: { durationMs: record.durationMs, maxMs: options.maxMs },
        };
      }, options);
    },

    tokens(options: { maxTotal?: number; maxInput?: number; maxOutput?: number }): EvalMetric {
      const configuredLimits = [options.maxTotal, options.maxInput, options.maxOutput].filter(
        (value) => value !== undefined,
      );
      if (configuredLimits.length === 0) {
        throw createEvalValidationError("Token budget must configure at least one limit");
      }
      for (const [label, value] of Object.entries(options)) {
        if (value !== undefined) assertNonNegativeInteger(value, `Token budget ${label}`);
      }
      return createMetric("ops.tokens", "ops", (record) => {
        const totalTokens = record.usage.totalTokens ??
          (record.usage.inputTokens !== undefined && record.usage.outputTokens !== undefined
            ? record.usage.inputTokens + record.usage.outputTokens
            : undefined);
        const missing = [
          ...(options.maxInput !== undefined && record.usage.inputTokens === undefined
            ? ["inputTokens"]
            : []),
          ...(options.maxOutput !== undefined && record.usage.outputTokens === undefined
            ? ["outputTokens"]
            : []),
          ...(options.maxTotal !== undefined && totalTokens === undefined ? ["totalTokens"] : []),
        ];
        if (missing.length > 0) {
          return {
            name: "ops.tokens",
            family: "ops",
            severity: "budget",
            score: 0,
            pass: false,
            explanation: "Token usage required by this budget was not measured.",
            evidence: { usage: record.usage, limits: options, missing },
          };
        }
        const inputOk = options.maxInput === undefined ||
          record.usage.inputTokens! <= options.maxInput;
        const outputOk = options.maxOutput === undefined ||
          record.usage.outputTokens! <= options.maxOutput;
        const totalOk = options.maxTotal === undefined || totalTokens! <= options.maxTotal;
        const pass = inputOk && outputOk && totalOk;
        return {
          name: "ops.tokens",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: { usage: record.usage, limits: options },
        };
      }, options as Record<string, unknown>);
    },

    cost(options: { maxUsd: number }): EvalMetric {
      assertFiniteNonNegative(options.maxUsd, "Cost maxUsd");
      return createMetric("ops.cost", "ops", (record) => {
        const costUsd = record.usage.veryfrontBilledUsd ?? record.usage.veryfrontChargeUsd ??
          record.usage.costUsd ?? record.usage.providerCostUsd;
        if (costUsd === undefined) {
          return {
            name: "ops.cost",
            family: "ops",
            severity: "budget",
            score: 0,
            pass: false,
            explanation: "Cost usage required by this budget was not measured.",
            evidence: { maxUsd: options.maxUsd },
          };
        }
        const pass = costUsd <= options.maxUsd;
        return {
          name: "ops.cost",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: {
            costUsd,
            maxUsd: options.maxUsd,
            ...(record.usage.costSource ? { costSource: record.usage.costSource } : {}),
          },
        };
      }, options);
    },
  },

  judge: {
    rubric(options: JudgeRubricInput): EvalMetric {
      assertNonEmptyMetricString(options.rubric, "Judge rubric");
      return createMetric("judge.rubric", "judge", async (record) => {
        if (!options.judge) {
          return {
            name: "judge.rubric",
            family: "judge",
            severity: "gate",
            skipped: true,
            explanation: "No judge function was provided.",
          };
        }

        const output = isRecord(record.output)
          ? record.output
          : { text: getOutputText(record.output) };
        const judged: unknown = await options.judge({
          rubric: options.rubric,
          input: record.input,
          output,
          reference: record.reference,
          metadata: record.metadata,
        });
        if (
          !isRecord(judged) || typeof judged.score !== "number" ||
          !Number.isFinite(judged.score) || judged.score < 0 || judged.score > 1 ||
          (judged.pass !== undefined && typeof judged.pass !== "boolean") ||
          (judged.explanation !== undefined && typeof judged.explanation !== "string")
        ) {
          return {
            name: "judge.rubric",
            family: "judge",
            severity: "gate",
            score: 0,
            pass: false,
            explanation: "Judge returned an invalid score.",
          };
        }
        const min = 0;

        return {
          name: "judge.rubric",
          family: "judge",
          severity: "gate",
          score: judged.score,
          pass: judged.pass ?? judged.score > min,
          ...(judged.explanation ? { explanation: judged.explanation } : {}),
        };
      }, { rubric: options.rubric });
    },
  },
} as const;

export { getOutputText, stableStringify };
