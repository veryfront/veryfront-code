import type {
  EvalAnswerGroundednessMetricOptions,
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

type MetricEvaluator = (record: EvalRecord) => EvalMetricResult | Promise<EvalMetricResult>;

type KnowledgeEntry = {
  source: string;
  sourceCandidates: string[];
  contentCandidates: string[];
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

function getOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.output === "string") return record.output;
  }
  return stableStringify(output);
}

function getOutputJson(output: unknown): unknown {
  if (output && typeof output === "object" && "json" in output) {
    return (output as { json: unknown }).json;
  }
  return output;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
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
  return typeof value === "string" && value.trim() ? [value] : [];
}

function collectFrontmatterValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const fieldValue = entry.value;
    if (typeof fieldValue === "string" && fieldValue.trim()) values.push(fieldValue);
  }
  return values;
}

function extractKnowledgeItems(output: unknown): unknown[] {
  if (Array.isArray(output)) return output;
  if (!isRecord(output)) return [];

  for (const key of KNOWLEDGE_COLLECTION_KEYS) {
    const value = output[key];
    if (Array.isArray(value)) return value;
  }

  return KNOWLEDGE_SOURCE_KEYS.some((key) => typeof output[key] === "string") ? [output] : [];
}

function createKnowledgeEntry(item: unknown): KnowledgeEntry | null {
  if (!isRecord(item)) {
    if (typeof item === "string" && item.trim()) {
      return { source: item, sourceCandidates: [item], contentCandidates: [item] };
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

  return {
    source,
    sourceCandidates: sourceCandidates.length === 0 ? [source] : sourceCandidates,
    contentCandidates,
  };
}

function getKnowledgeEntries(record: EvalRecord, tool = DEFAULT_KNOWLEDGE_TOOL): KnowledgeEntry[] {
  return findEvalToolCalls(record, tool)
    .filter((call) => !isEvalToolFailed(call))
    .flatMap((call) => extractKnowledgeItems(call.output))
    .map(createKnowledgeEntry)
    .filter((entry): entry is KnowledgeEntry => entry !== null);
}

function expectedSourceLabel(expected: EvalKnowledgeExpectedSource): string {
  if (typeof expected === "string") return expected;
  return expected.path ?? expected.source ?? expected.documentCode ?? expected.document_code ??
    expected.id ?? expected.title ?? expected.contentMatch ?? expected.verificationQuote ??
    expected.content ?? expected.text ?? stableStringify(expected);
}

function normalizeExpectedKnowledgeSources(value: unknown): EvalKnowledgeExpectedSource[] {
  const values = Array.isArray(value) ? value : [value];
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
  return {
    expected: normalizeExpectedKnowledgeSources(getPathValue(record, expectedFrom)),
    expectedFrom,
  };
}

function createKnowledgeMetricConfig(
  options: EvalKnowledgeRetrievalMetricOptions | EvalKnowledgeMrrMetricOptions,
): Record<string, unknown> {
  return {
    ...options,
    ...(!options.expected
      ? { expectedFrom: options.expectedFrom ?? DEFAULT_EXPECTED_KNOWLEDGE_PATH }
      : {}),
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
  const base = { ...metric, severity, ...(threshold ? { threshold } : {}) };
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
      if (!threshold || result.skipped || typeof next.score !== "number") {
        return next;
      }

      const minPass = threshold.min === undefined || next.score >= threshold.min;
      const maxPass = threshold.max === undefined || next.score <= threshold.max;
      const thresholdPass = minPass && maxPass;
      return {
        ...next,
        pass: next.pass === undefined ? thresholdPass : next.pass && thresholdPass,
      };
    },
    gate(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "gate", nextThreshold ?? threshold);
    },
    soft(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "soft", nextThreshold ?? threshold);
    },
    budget(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "budget", nextThreshold ?? threshold);
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
      return createMetric("answer.regex", "answer", (record) => {
        const pattern = new RegExp(options.pattern, options.flags);
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
        const pass = stableStringify(actual) === stableStringify(expected);
        return scoreResult("answer.jsonMatch", "answer", "gate", pass);
      }, options as Record<string, unknown>);
    },

    groundedness(options: EvalAnswerGroundednessMetricOptions = {}): EvalMetric {
      return createMetric("answer.groundedness", "answer", async (record) => {
        const tool = options.tool ?? DEFAULT_KNOWLEDGE_TOOL;
        const entries = getKnowledgeEntries(record, tool);
        const evidence = uniqueStrings(entries.flatMap((entry) => entry.contentCandidates));
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

        const output = record.output && typeof record.output === "object"
          ? record.output as Record<string, unknown>
          : { text: getOutputText(record.output) };
        const judged = await options.judge({
          rubric: options.rubric ?? DEFAULT_GROUNDEDNESS_RUBRIC,
          input: record.input,
          output,
          reference: record.reference,
          metadata: record.metadata,
          evidence,
          sources,
        });

        return {
          name: "answer.groundedness",
          family: "answer",
          severity: "gate",
          score: judged.score,
          pass: judged.pass ?? judged.score > 0,
          ...(judged.explanation ? { explanation: judged.explanation } : {}),
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
  },

  ops: {
    latency(options: { maxMs: number }): EvalMetric {
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
      return createMetric("ops.tokens", "ops", (record) => {
        const inputOk = options.maxInput === undefined ||
          (record.usage.inputTokens ?? 0) <= options.maxInput;
        const outputOk = options.maxOutput === undefined ||
          (record.usage.outputTokens ?? 0) <= options.maxOutput;
        const totalOk = options.maxTotal === undefined ||
          (record.usage.totalTokens ?? 0) <= options.maxTotal;
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
      return createMetric("ops.cost", "ops", (record) => {
        const costUsd = record.usage.costUsd ?? 0;
        const pass = costUsd <= options.maxUsd;
        return {
          name: "ops.cost",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: { costUsd, maxUsd: options.maxUsd },
        };
      }, options);
    },
  },

  judge: {
    rubric(options: JudgeRubricInput): EvalMetric {
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

        const output = record.output && typeof record.output === "object"
          ? record.output as Record<string, unknown>
          : { text: getOutputText(record.output) };
        const judged = await options.judge({
          rubric: options.rubric,
          input: record.input,
          output,
          reference: record.reference,
          metadata: record.metadata,
        });
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
