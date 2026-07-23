import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { DiscoveredEval } from "./discovery.ts";
import type { EvalDefinition, EvalExample } from "./types.ts";

const MAX_EVAL_STUDIO_TEXT_LENGTH = 16_384;
const MAX_EVAL_STUDIO_SOURCE_LENGTH = 4 * 1024 * 1024;
const MAX_EVAL_STUDIO_EXAMPLES = 100_000;
const MAX_EVAL_STUDIO_METRICS = 1_000;
const MAX_EVAL_STUDIO_TAGS = 1_000;
const MAX_EVAL_STUDIO_FAILURES = 100_000;
const MAX_EVAL_STUDIO_REPETITIONS = 10_000;

/** Schema for Eval Studio capabilities. */
export const getEvalStudioCapabilitySchema = defineSchema((v) =>
  v.enum(["project.evals.read", "project.evals.write", "project.evals.run"] as const)
);

/** Schema for an Eval target primitive kind. */
export const getEvalTargetKindSchema = defineSchema((v) => v.enum(["agent", "tool"] as const));

/** Schema for an editable Eval source field name. */
export const getEvalEditableFieldSchema = defineSchema((v) =>
  v.enum(
    [
      "name",
      "description",
      "target",
      "dataset",
      "repetitions",
      "tags",
      "metadata",
      "metrics",
      "input",
      "check",
    ] as const,
  )
);

/** Schema for an Eval source reference. */
export const getEvalSourceReferenceSchema = defineSchema((v) =>
  v.object({
    filePath: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    exportName: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    content: v.string().max(MAX_EVAL_STUDIO_SOURCE_LENGTH).optional(),
  })
);

/** Schema for an Eval example in Studio source documents. */
export const getEvalSourceExampleSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    input: v.unknown(),
    reference: v.unknown().optional(),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

/** Schema for an Eval dataset in Studio source documents. */
export const getEvalSourceDatasetSchema = defineSchema((v) =>
  v.object({
    kind: v.enum(["inline", "json", "jsonl", "dynamic"] as const),
    path: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH).optional(),
    examples: v.array(getEvalSourceExampleSchema()).max(MAX_EVAL_STUDIO_EXAMPLES).optional(),
    editable: v.boolean(),
    dynamic: v.boolean(),
  })
);

/** Schema for an Eval metric in Studio source documents. */
export const getEvalSourceMetricSchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    family: v.enum(["answer", "agent", "ops", "judge", "knowledge", "check"] as const),
    severity: v.enum(["gate", "soft", "budget"] as const),
    threshold: v.object({
      min: v.number().optional(),
      max: v.number().optional(),
    }).optional(),
    config: v.record(v.string(), v.unknown()).optional(),
    editable: v.boolean(),
    dynamic: v.boolean(),
  })
);

/** Schema for an Eval report metric summary in Studio run projections. */
export const getEvalRunMetricSummarySchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    family: v.enum(["answer", "agent", "ops", "judge", "knowledge", "check"] as const),
    severity: v.enum(["gate", "soft", "budget"] as const),
    passed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
    failed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
    skipped: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
    passRate: v.number().min(0).max(1),
  })
);

/** Schema for Eval duration aggregates in Studio run projections. */
export const getEvalRunDurationSummarySchema = defineSchema((v) =>
  v.object({
    totalMs: v.number().nonnegative(),
    minMs: v.number().nonnegative(),
    maxMs: v.number().nonnegative(),
    meanMs: v.number().nonnegative(),
    p50Ms: v.number().nonnegative(),
    p95Ms: v.number().nonnegative(),
  })
);

/** Schema for Eval usage totals in Studio run projections. */
export const getEvalRunUsageSummarySchema = defineSchema((v) =>
  v.object({
    inputTokens: v.number().nonnegative().optional(),
    outputTokens: v.number().nonnegative().optional(),
    totalTokens: v.number().nonnegative().optional(),
    billableInputTokens: v.number().nonnegative().optional(),
    billableOutputTokens: v.number().nonnegative().optional(),
    cachedInputTokens: v.number().nonnegative().optional(),
    cacheCreationInputTokens: v.number().nonnegative().optional(),
    cacheReadInputTokens: v.number().nonnegative().optional(),
    reasoningTokens: v.number().nonnegative().optional(),
    costUsd: v.number().nonnegative().optional(),
    providerInputCostUsd: v.number().nonnegative().optional(),
    providerOutputCostUsd: v.number().nonnegative().optional(),
    providerCostUsd: v.number().nonnegative().optional(),
    veryfrontInputChargeUsd: v.number().nonnegative().optional(),
    veryfrontOutputChargeUsd: v.number().nonnegative().optional(),
    veryfrontChargeUsd: v.number().nonnegative().optional(),
    veryfrontBilledUsd: v.number().nonnegative().optional(),
    costCredits: v.number().nonnegative().optional(),
    costSource: v.enum(["gateway", "missing", "partial"] as const).optional(),
    billingMode: v.enum(["direct", "deferred"] as const).optional(),
    usageCaptureStatus: v.enum(["complete", "partial", "missing"] as const).optional(),
  })
);

/** Schema for blocking Eval failures in Studio run projections. */
export const getEvalRunGateFailureSummarySchema = defineSchema((v) =>
  v.object({
    recordId: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    exampleId: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    repetition: v.number().int().positive().max(MAX_EVAL_STUDIO_REPETITIONS),
    name: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    family: v.enum(["answer", "agent", "ops", "judge", "knowledge", "check"] as const),
    severity: v.enum(["gate", "budget"] as const),
    explanation: v.string().max(MAX_EVAL_STUDIO_SOURCE_LENGTH).optional(),
    evidence: v.record(v.string(), v.unknown()).optional(),
  })
);

/** Schema for failed Eval examples in Studio run projections. */
export const getEvalRunFailedExampleSummarySchema = defineSchema((v) =>
  v.object({
    exampleId: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    records: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
    passed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
    failed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
    passRate: v.number().min(0).max(1),
    flaky: v.boolean(),
  })
);

/** Schema for Eval flake aggregates in Studio run projections. */
export const getEvalRunFlakeSummarySchema = defineSchema((v) =>
  v.object({
    examples: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_EXAMPLES),
    stablePassed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_EXAMPLES),
    stableFailed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_EXAMPLES),
    flaky: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_EXAMPLES),
  })
);

/** Schema for a Studio-editable Eval source document. */
export const getEvalSourceDocumentSchema = defineSchema((v) =>
  v.object({
    kind: v.literal("eval-source-document"),
    id: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    name: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    description: v.string().max(MAX_EVAL_STUDIO_SOURCE_LENGTH).optional(),
    targetKind: getEvalTargetKindSchema(),
    target: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    source: getEvalSourceReferenceSchema(),
    dataset: getEvalSourceDatasetSchema(),
    metrics: v.array(getEvalSourceMetricSchema()).max(MAX_EVAL_STUDIO_METRICS),
    repetitions: v.number().int().positive().max(MAX_EVAL_STUDIO_REPETITIONS),
    tags: v.array(v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH)).max(MAX_EVAL_STUDIO_TAGS),
    metadata: v.record(v.string(), v.unknown()),
    editableFields: v.array(getEvalEditableFieldSchema()),
    dynamicFields: v.array(getEvalEditableFieldSchema()),
    capabilities: v.array(getEvalStudioCapabilitySchema()).max(3),
  })
);

/** Schema for a source patch submitted from an Eval editor. */
export const getEvalSourcePatchSchema = defineSchema((v) =>
  v.object({
    kind: v.literal("eval-source-patch"),
    id: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    source: getEvalSourceReferenceSchema(),
    fields: v.object({
      name: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH).optional(),
      description: v.string().max(MAX_EVAL_STUDIO_SOURCE_LENGTH).optional(),
      target: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH).optional(),
      dataset: getEvalSourceDatasetSchema().optional(),
      repetitions: v.number().int().positive().max(MAX_EVAL_STUDIO_REPETITIONS).optional(),
      tags: v.array(v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH)).max(
        MAX_EVAL_STUDIO_TAGS,
      ).optional(),
      metadata: v.record(v.string(), v.unknown()).optional(),
      metrics: v.array(getEvalSourceMetricSchema()).max(MAX_EVAL_STUDIO_METRICS).optional(),
    }).strict(),
  })
);

/** Schema for V2-ready Eval run projections. */
export const getEvalRunSchema = defineSchema((v) =>
  v.object({
    kind: v.literal("eval-run"),
    runId: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    evalId: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    status: v.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"] as const),
    targetKind: getEvalTargetKindSchema(),
    target: v.string().min(1).max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    source: getEvalSourceReferenceSchema().optional(),
    summary: v.object({
      records: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
      passed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
      failed: v.number().int().nonnegative().max(MAX_EVAL_STUDIO_FAILURES),
      passRate: v.number().min(0).max(1),
      skippedResults: v.number().int().nonnegative().optional(),
      metrics: v.array(getEvalRunMetricSummarySchema()).max(MAX_EVAL_STUDIO_METRICS).optional(),
      duration: getEvalRunDurationSummarySchema().optional(),
      usage: getEvalRunUsageSummarySchema().optional(),
      gateFailures: v.array(getEvalRunGateFailureSummarySchema()).max(
        MAX_EVAL_STUDIO_FAILURES,
      ).optional(),
      failedExamples: v.array(getEvalRunFailedExampleSummarySchema()).max(
        MAX_EVAL_STUDIO_FAILURES,
      ).optional(),
      flakes: getEvalRunFlakeSummarySchema().optional(),
    }).nullable(),
    reportPath: v.string().max(MAX_EVAL_STUDIO_TEXT_LENGTH).nullable(),
    error: v.unknown().nullable(),
    metadata: v.record(v.string(), v.unknown()),
    createdAt: v.string().max(MAX_EVAL_STUDIO_TEXT_LENGTH),
    startedAt: v.string().max(MAX_EVAL_STUDIO_TEXT_LENGTH).nullable(),
    completedAt: v.string().max(MAX_EVAL_STUDIO_TEXT_LENGTH).nullable(),
  })
);

/** Capability string Studio uses for Eval source and run actions. */
export type EvalStudioCapability = InferSchema<ReturnType<typeof getEvalStudioCapabilitySchema>>;
/** Form-editable Eval source field name. */
export type EvalEditableField = InferSchema<ReturnType<typeof getEvalEditableFieldSchema>>;
/** Source location for an Eval definition. */
export type EvalSourceReference = InferSchema<ReturnType<typeof getEvalSourceReferenceSchema>>;
/** Studio-editable Eval source document. */
export type EvalSourceDocument = InferSchema<ReturnType<typeof getEvalSourceDocumentSchema>>;
/** Eval source patch submitted by Studio forms. */
export type EvalSourcePatch = InferSchema<ReturnType<typeof getEvalSourcePatchSchema>>;
/** V2-ready Eval run projection. */
export type EvalRun = InferSchema<ReturnType<typeof getEvalRunSchema>>;

/** Options for creating a Studio source document from a discovered eval. */
export interface CreateEvalSourceDocumentOptions {
  sourceText?: string;
  capabilities?: EvalStudioCapability[];
}

const DEFAULT_EVAL_STUDIO_CAPABILITIES: EvalStudioCapability[] = [
  "project.evals.read",
  "project.evals.write",
  "project.evals.run",
];

const BASE_EDITABLE_FIELDS: EvalEditableField[] = [
  "name",
  "description",
  "target",
  "dataset",
  "repetitions",
  "tags",
  "metadata",
  "metrics",
];

function normalizeDataset(definition: EvalDefinition): EvalSourceDocument["dataset"] {
  const dataset = definition.dataset;
  const dynamic = !["inline", "json", "jsonl"].includes(dataset.kind);
  return {
    kind: dynamic ? "dynamic" : dataset.kind,
    ...(dataset.path ? { path: dataset.path } : {}),
    ...(dataset.examples ? { examples: dataset.examples.map(copyExample) } : {}),
    editable: !dynamic,
    dynamic,
  };
}

function copyExample(example: EvalExample): EvalExample {
  return {
    id: example.id,
    input: example.input,
    ...(example.reference !== undefined ? { reference: example.reference } : {}),
    ...(example.metadata ? { metadata: { ...example.metadata } } : {}),
  };
}

function createSourceMetric(
  metric: EvalDefinition["metrics"][number],
): EvalSourceDocument["metrics"][number] {
  const dynamic = metric.family === "judge" || metric.family === "check" ||
    metric.name === "answer.groundedness";
  return {
    name: metric.name,
    family: metric.family,
    severity: metric.severity,
    ...(metric.threshold ? { threshold: { ...metric.threshold } } : {}),
    ...(metric.config ? { config: { ...metric.config } } : {}),
    editable: !!metric.config || metric.name === "agent.noFailedTools",
    dynamic,
  };
}

/** Create the normalized Eval document Studio can list, inspect, and edit. */
export function createEvalSourceDocument(
  discovered: DiscoveredEval,
  options: CreateEvalSourceDocumentOptions = {},
): EvalSourceDocument {
  const { definition } = discovered;
  const dynamicFields: EvalEditableField[] = [
    ...(definition.input ? ["input" as const] : []),
    ...(definition.check ? ["check" as const] : []),
  ];

  return getEvalSourceDocumentSchema().parse({
    kind: "eval-source-document",
    id: discovered.id,
    name: definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    targetKind: definition.targetKind,
    target: definition.target,
    source: {
      filePath: discovered.filePath,
      exportName: discovered.exportName,
      ...(options.sourceText ? { content: options.sourceText } : {}),
    },
    dataset: normalizeDataset(definition),
    metrics: definition.metrics.map(createSourceMetric),
    repetitions: definition.repetitions,
    tags: [...definition.tags],
    metadata: { ...definition.metadata },
    editableFields: BASE_EDITABLE_FIELDS,
    dynamicFields,
    capabilities: options.capabilities ?? DEFAULT_EVAL_STUDIO_CAPABILITIES,
  });
}
