/**
 * Types for Veryfront eval definitions, datasets, metrics, and reports.
 *
 * @module eval
 */

/** Primitive kind an eval can execute. */
export type EvalTargetKind = "agent" | "tool";

/** How a metric result affects the final eval result. */
export type EvalSeverity = "gate" | "soft" | "budget";

/** Metric family used for grouping report summaries. */
export type EvalMetricFamily = "answer" | "agent" | "ops" | "judge" | "knowledge" | "check";

/** Numeric threshold attached to score-based metrics. */
export type EvalMetricThreshold = {
  min?: number;
  max?: number;
};

/** Value that can be returned synchronously or as a promise. */
export type EvalMaybePromise<T> = T | Promise<T>;

/** Redaction policy applied before reports leave the process. */
export interface EvalReportExportRedaction {
  includeInputs?: boolean;
  includeOutputs?: boolean;
  includeReferences?: boolean;
  includeTraces?: boolean;
  includeMetricExplanations?: boolean;
  includeMetricEvidence?: boolean;
  metadataAllowlist?: string[];
}

/** Trace correlation fields that connect eval exports to runtime spans. */
export interface EvalReportExportTraceContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

/** Context passed to eval report exporters. */
export interface EvalReportExportContext {
  projectId?: string;
  projectReference?: string;
  evalId?: string;
  sourcePath?: string;
  reportPath?: string;
  environment?: string;
  branch?: string;
  commitSha?: string;
  runUrl?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  trace?: EvalReportExportTraceContext;
  redaction?: EvalReportExportRedaction;
}

/** Optional receipt returned by a vendor exporter. */
export interface EvalReportExportReceipt {
  externalRunId?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

/** Vendor or backend implementation that receives sanitized eval reports. */
export interface EvalReportExporter {
  readonly id: string;
  export(
    report: EvalReport,
    context: EvalReportExportContext,
  ): EvalMaybePromise<EvalReportExportReceipt | void>;
}

/** Successful exporter result. */
export interface EvalReportExportSuccess {
  exporterId: string;
  ok: true;
  receipt?: EvalReportExportReceipt;
}

/** Failed exporter result. */
export interface EvalReportExportFailure {
  exporterId: string;
  ok: false;
  error: string;
}

/** Result for one exporter invocation. */
export type EvalReportExportResult = EvalReportExportSuccess | EvalReportExportFailure;

/** Registry contract for eval report exporters. */
export interface EvalReportExporterRegistry {
  register(exporter: EvalReportExporter): void;
  unregister(id: string): void;
  get(id: string): EvalReportExporter | undefined;
  require(id: string): EvalReportExporter;
  list(): EvalReportExporter[];
  has(id: string): boolean;
  export(
    report: EvalReport,
    context?: EvalReportExportContext,
  ): Promise<EvalReportExportResult[]>;
}

/** Normalized dataset example used by eval runners and reports. */
export interface EvalExample {
  id: string;
  input: unknown;
  reference?: unknown;
  metadata?: Record<string, unknown>;
}

/** Dataset example shape accepted by eval definitions. */
export type EvalExampleInput = {
  id: string;
  input: unknown;
  reference?: unknown;
  metadata?: Record<string, unknown>;
};

/** Context passed to dataset loaders. */
export interface EvalDatasetLoadContext {
  baseDir: string;
}

/** Dataset loader used by an eval definition. */
export interface EvalDataset {
  kind: "inline" | "json" | "jsonl";
  path?: string;
  examples?: EvalExample[];
  load(context: EvalDatasetLoadContext): Promise<EvalExample[]>;
}

/** Source and completeness of cost data captured for eval usage. */
export type EvalUsageCostSource = "gateway" | "missing" | "partial";

/** Completeness of provider usage capture for eval usage. */
export type EvalUsageCaptureStatus = "complete" | "partial" | "missing";

/** Billing boundary for gateway-backed eval usage. */
export type EvalUsageBillingMode = "direct" | "deferred";

/** Token and cost usage captured for one eval record. */
export interface EvalUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: EvalUsageCostSource;
  billingMode?: EvalUsageBillingMode;
  usageCaptureStatus?: EvalUsageCaptureStatus;
}

/** Normalized status for a tool call captured during an eval record. */
export type EvalToolCallStatus = "ok" | "error" | "skipped" | "denied";

/** How expected tool input is compared to the captured tool input. */
export type EvalToolInputMatchMode = "exact" | "partial";

/** Options for matching a required tool call. */
export interface EvalToolCallMatchOptions {
  input?: unknown;
  match?: EvalToolInputMatchMode;
}

/** Options for checking how often a tool was called. */
export interface EvalToolCallCountOptions {
  exact?: number;
  min?: number;
  max?: number;
}

/** Expected knowledge source or passage for retrieval-quality metrics. */
export type EvalKnowledgeExpectedSource = string | {
  path?: string;
  source?: string;
  id?: string;
  title?: string;
  documentCode?: string;
  document_code?: string;
  contentMatch?: string;
  verificationQuote?: string;
  content?: string;
  text?: string;
};

/** Options shared by knowledge retrieval metrics. */
export interface EvalKnowledgeRetrievalMetricOptions {
  expected?: EvalKnowledgeExpectedSource[];
  expectedFrom?: string;
  k: number;
  tool?: string;
}

/** Options for mean reciprocal rank over retrieved knowledge. */
export interface EvalKnowledgeMrrMetricOptions {
  expected?: EvalKnowledgeExpectedSource[];
  expectedFrom?: string;
  k?: number;
  tool?: string;
}

/** Options for citation precision and recall over retrieved knowledge. */
export interface EvalKnowledgeCitationMetricOptions {
  expected?: EvalKnowledgeExpectedSource[];
  expectedFrom?: string;
  k?: number;
  tool?: string;
  citationsFrom?: string;
}

/** Options for judge-backed answer grounding checks. */
export interface EvalAnswerGroundednessMetricOptions {
  tool?: string;
  rubric?: string;
  judge?: (input: {
    rubric: string;
    input: unknown;
    output: Record<string, unknown>;
    reference?: unknown;
    metadata: Record<string, unknown>;
    evidence: string[];
    sources: string[];
  }) => EvalMaybePromise<{ score: number; pass?: boolean; explanation?: string }>;
}

/** Retrieved context item captured for deterministic RAG metrics. */
export interface EvalRetrievedContext {
  /** Stable source id, path, URL, or document key for this retrieved item. */
  source: string;
  /** Optional retrieved passage text used by groundedness and content matching. */
  content?: string;
  /** Optional display title for the source. */
  title?: string;
  /** Optional adapter-specific metadata. */
  metadata?: Record<string, unknown>;
}

/** Citation emitted by an answer and matched against retrieved or expected sources. */
export interface EvalCitation {
  /** Stable source id, path, URL, or document key being cited. */
  source: string;
  /** Optional answer citation marker or label, such as "[1]". */
  text?: string;
  /** Optional quoted passage attached to the citation. */
  quote?: string;
  /** Optional adapter-specific metadata. */
  metadata?: Record<string, unknown>;
}

/** Tool call metadata captured during one eval record. */
export interface EvalToolCall {
  id?: string;
  name: string;
  status?: EvalToolCallStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Trace metadata captured for one eval record. */
export interface EvalTrace {
  events: unknown[];
  toolCalls: EvalToolCall[];
}

/** One executed example and repetition inside an eval report. */
export interface EvalRecord {
  id: string;
  evalId: string;
  exampleId: string;
  repetition: number;
  input: unknown;
  executionInput?: unknown;
  output: unknown;
  reference?: unknown;
  metadata: Record<string, unknown>;
  retrievedContext?: EvalRetrievedContext[];
  citations?: EvalCitation[];
  trace: EvalTrace;
  usage: EvalUsage;
  durationMs: number;
  completed: boolean;
  error?: string;
  metrics?: EvalMetricResult[];
  checks?: EvalMetricResult[];
}

/** Result emitted by a metric or check assertion. */
export interface EvalMetricResult {
  name: string;
  family: EvalMetricFamily;
  severity: EvalSeverity;
  score?: number;
  pass?: boolean;
  skipped?: boolean;
  label?: string;
  explanation?: string;
  evidence?: Record<string, unknown>;
}

/** Optional runtime context passed to metric evaluators. */
export interface EvalMetricContext {
  now?: () => Date;
}

/** Metric contract used by eval definitions. */
export interface EvalMetric {
  name: string;
  family: EvalMetricFamily;
  severity: EvalSeverity;
  threshold?: EvalMetricThreshold;
  config?: Record<string, unknown>;
  evaluate(record: EvalRecord, context?: EvalMetricContext): EvalMaybePromise<EvalMetricResult>;
  gate(threshold?: EvalMetricThreshold): EvalMetric;
  soft(threshold?: EvalMetricThreshold): EvalMetric;
  budget(threshold?: EvalMetricThreshold): EvalMetric;
}

/** Fluent severity helpers for `check` expectations. */
export interface EvalExpectation {
  gate(threshold?: EvalMetricThreshold): EvalMetricResult;
  soft(threshold?: EvalMetricThreshold): EvalMetricResult;
  budget(threshold?: EvalMetricThreshold): EvalMetricResult;
}

/** Built-in expectation helpers available inside `check`. */
export interface EvalExpect {
  completed(): EvalExpectation;
  outputContains(text: string): EvalExpectation;
  noFailedTools(): EvalExpectation;
  calledTool(name: string, options?: EvalToolCallMatchOptions): EvalExpectation;
  notCalledTool(name: string): EvalExpectation;
  toolCallCount(name: string, options: EvalToolCallCountOptions): EvalExpectation;
}

/** Context passed to an eval definition's `check` callback. */
export interface EvalCheckContext {
  definition: EvalDefinition;
  example: EvalExample;
  repetition: number;
  record: EvalRecord;
  expect: EvalExpect;
}

/** Source location for a discovered eval definition. */
export interface EvalSource {
  filePath: string;
  exportName: string;
}

/** First-class eval definition discovered from project source. */
export interface EvalDefinition {
  kind: "eval";
  targetKind: EvalTargetKind;
  id: string;
  name: string;
  description?: string;
  target: string;
  dataset: EvalDataset;
  metrics: EvalMetric[];
  repetitions: number;
  tags: string[];
  metadata: Record<string, unknown>;
  source?: EvalSource;
  input?: (example: EvalExample) => EvalMaybePromise<unknown>;
  check?: (context: EvalCheckContext) => EvalMaybePromise<void>;
}

/** Input accepted by `evalAgent`. */
export interface EvalAgentInput {
  id?: string;
  name?: string;
  description?: string;
  target: string;
  dataset: EvalDataset | EvalExampleInput[];
  metrics?: EvalMetric[];
  repetitions?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  check?: (context: EvalCheckContext) => EvalMaybePromise<void>;
}

/** Input accepted by `evalTool`. */
export interface EvalToolInput {
  id?: string;
  name?: string;
  description?: string;
  target: string;
  dataset: EvalDataset | EvalExampleInput[];
  /**
   * Optional mapper from dataset example to tool input. When omitted, the
   * dataset example's `input` value is passed to the tool adapter unchanged.
   */
  input?: (example: EvalExample) => EvalMaybePromise<unknown>;
  metrics?: EvalMetric[];
  repetitions?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  check?: (context: EvalCheckContext) => EvalMaybePromise<void>;
}

/** Context passed to an agent adapter when `runEval` executes an example. */
export interface EvalAgentAdapterContext {
  definition: EvalDefinition;
  example: EvalExample;
  repetition: number;
}

/** Agent adapter result normalized into an eval record. */
export interface EvalAgentAdapterResult {
  text?: string;
  json?: unknown;
  output?: unknown;
  retrievedContext?: EvalRetrievedContext[];
  citations?: EvalCitation[];
  trace?: Partial<EvalTrace>;
  usage?: EvalUsage;
  durationMs?: number;
  completed?: boolean;
  error?: string;
}

/** Adapter used by `runEval` to execute V1 agent targets. */
export type EvalAgentAdapter = (
  context: EvalAgentAdapterContext,
) => EvalMaybePromise<string | EvalAgentAdapterResult>;

/** Context passed to a tool adapter when `runEval` executes an example. */
export interface EvalToolAdapterContext {
  definition: EvalDefinition;
  example: EvalExample;
  repetition: number;
  runId: string;
  input: unknown;
}

/** Tool adapter result normalized into an eval record. */
export interface EvalToolAdapterResult {
  output: unknown;
  toolCallId?: string;
  trace?: Partial<EvalTrace>;
  usage?: EvalUsage;
  durationMs?: number;
  completed?: boolean;
  error?: string;
}

/** Adapter used by `runEval` to execute tool targets. */
export type EvalToolAdapter = (
  context: EvalToolAdapterContext,
) => EvalMaybePromise<EvalToolAdapterResult>;

/** Options for running an eval locally. */
export interface RunEvalOptions {
  adapters: {
    agent?: EvalAgentAdapter;
    tool?: EvalToolAdapter;
  };
  baseDir?: string;
  runId?: string;
  now?: () => Date;
  export?: EvalReportExportConfig;
  metadata?: EvalReportMetadata;
}

/** Export configuration for a completed eval report. */
export interface EvalReportExportConfig {
  registry?: EvalReportExporterRegistry;
  exporterIds?: string[];
  context?: EvalReportExportContext;
}

/** Aggregate pass/fail summary for one metric. */
export interface EvalMetricSummary {
  name: string;
  family: EvalMetricFamily;
  severity: EvalSeverity;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
}

/** Duration aggregate for an eval report. */
export interface EvalDurationSummary {
  totalMs: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

/** Usage totals for an eval report. */
export interface EvalUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: EvalUsageCostSource;
  billingMode?: EvalUsageBillingMode;
  usageCaptureStatus?: EvalUsageCaptureStatus;
}

/** Blocking failure included in a report summary. */
export interface EvalGateFailureSummary {
  recordId: string;
  exampleId: string;
  repetition: number;
  name: string;
  family: EvalMetricFamily;
  severity: "gate" | "budget";
  explanation?: string;
  evidence?: Record<string, unknown>;
}

/** Per-example failure aggregate included in a report summary. */
export interface EvalFailedExampleSummary {
  exampleId: string;
  records: number;
  passed: number;
  failed: number;
  passRate: number;
  flaky: boolean;
}

/** Flake classification for repeated eval examples. */
export interface EvalFlakeSummary {
  examples: number;
  stablePassed: number;
  stableFailed: number;
  flaky: number;
}

/** Per-metric delta between a current eval report and a baseline report. */
export interface EvalMetricDeltaSummary {
  name: string;
  family: EvalMetricFamily;
  severity: EvalSeverity;
  baselinePassRate: number | null;
  currentPassRate: number | null;
  passRateDelta: number | null;
  baselineFailed: number | null;
  currentFailed: number | null;
  failedDelta: number | null;
  regressed: boolean;
}

/** Numeric budget delta between a current eval report and a baseline report. */
export interface EvalBudgetDeltaSummary {
  name: string;
  family: "usage" | "latency";
  baselineValue: number;
  currentValue: number;
  delta: number;
  percentDelta: number | null;
  threshold: number | null;
  regressed: boolean;
}

/** Regression policy for comparing a current eval report to a saved baseline. */
export interface EvalReportComparisonPolicy {
  passRateDropThreshold?: number;
  metricPassRateDropThreshold?: number;
  failedDeltaThreshold?: number;
  usageIncreaseThreshold?: number;
  latencyIncreaseThreshold?: number;
}

/** Baseline comparison for a current eval report. */
export interface EvalReportComparison {
  kind: "eval-report-comparison";
  currentRunId: string;
  baselineRunId: string;
  passRateDelta: number;
  passedDelta: number;
  failedDelta: number;
  metricDeltas: EvalMetricDeltaSummary[];
  budgetDeltas: EvalBudgetDeltaSummary[];
  newFailedExamples: string[];
  fixedExamples: string[];
  regressed: boolean;
}

/** Runtime and source identity attached to an eval report. */
export interface EvalRunProvenance {
  kind: "eval-run-provenance";
  environment: "local" | "cloud" | "ci" | "unknown";
  source: {
    kind: "git" | "release" | "deployment" | "preview" | "workspace" | "unknown";
    id?: string;
  };
  frameworkVersion?: string;
  git?: {
    sha?: string;
    branch?: string;
    dirty?: boolean;
    dirtyHash?: string;
  };
  cloud?: {
    projectId?: string;
    projectSlug?: string;
    releaseId?: string;
    deploymentId?: string;
    branchId?: string;
    branchRef?: string;
    environment?: string;
  };
}

/** Additional report metadata that should not affect pass/fail semantics. */
export interface EvalReportMetadata {
  model?: string;
  provenance?: EvalRunProvenance;
}

/** Stable dataset identity attached to new eval reports when examples are available. */
export interface EvalReportDatasetMetadata {
  kind: EvalDataset["kind"];
  path?: string;
  examples: number;
  hash: string;
}

/** Per-model row in an eval model comparison report. */
export interface EvalModelReportSummary {
  model: string;
  role: "baseline" | "candidate";
  runId: string;
  passed: number;
  failed: number;
  passRate: number;
  failedExamples: string[];
  gateFailures: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: EvalUsageCostSource;
  billingMode?: EvalUsageBillingMode;
  usageCaptureStatus?: EvalUsageCaptureStatus;
  p95Ms?: number;
  groundednessScore?: number;
}

/** Candidate-vs-baseline comparison used to decide whether a model is promotable. */
export interface EvalModelCandidateComparison {
  model: string;
  baselineModel: string;
  passRateDelta: number;
  failedDelta: number;
  newFailedExamples: string[];
  groundednessScore?: number;
  costImprovementPct?: number;
  tokenImprovementPct?: number;
  latencyImprovementPct?: number;
  constraintFailures?: string[];
  objectiveScore?: number;
  decision: EvalModelComparisonDecision;
  reasons: string[];
}

/** Conservative model comparison recommendation. */
export type EvalModelComparisonDecision =
  | "promote-candidate"
  | "keep-baseline"
  | "needs-review";

/** Aggregate report for comparing one baseline model against candidate models. */
export interface EvalModelComparison {
  kind: "eval-model-comparison";
  baselineModel: string;
  candidateModels: string[];
  models: EvalModelReportSummary[];
  candidates: EvalModelCandidateComparison[];
  recommendation: {
    decision: EvalModelComparisonDecision;
    model?: string;
    reasons: string[];
  };
}

/** Metric names available to model comparison constraints and objectives. */
export type EvalModelComparisonMetricName =
  | "passRate"
  | "failed"
  | "gateFailures"
  | "groundednessScore"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "billableInputTokens"
  | "billableOutputTokens"
  | "costUsd"
  | "providerInputCostUsd"
  | "providerOutputCostUsd"
  | "providerCostUsd"
  | "veryfrontInputChargeUsd"
  | "veryfrontOutputChargeUsd"
  | "veryfrontChargeUsd"
  | "veryfrontBilledUsd"
  | "costCredits"
  | "p95Ms";

/** Hard model comparison eligibility constraint. */
export interface EvalModelComparisonConstraint {
  min?: number;
  max?: number;
  maxRegressionPct?: number;
}

/** Weighted model comparison objective used to rank eligible candidates. */
export interface EvalModelComparisonObjective {
  weight: number;
  direction: "minimize" | "maximize";
}

/** Promotion thresholds for model comparison. */
export interface EvalModelComparisonOptions {
  baselineModel: string;
  minGroundedness?: number;
  minCostImprovementPct?: number;
  minTokenImprovementPct?: number;
  minLatencyImprovementPct?: number;
  constraints?: Partial<Record<EvalModelComparisonMetricName, EvalModelComparisonConstraint>>;
  objectives?: Partial<Record<EvalModelComparisonMetricName, EvalModelComparisonObjective>>;
}

/** Aggregate pass/fail summary for one eval report. */
export interface EvalReportSummary {
  records: number;
  passed: number;
  failed: number;
  passRate: number;
  metrics: EvalMetricSummary[];
  /** Count of skipped metric and check results. */
  skippedResults?: number;
  /** Duration aggregate across records. */
  duration?: EvalDurationSummary;
  /** Usage totals across records. */
  usage?: EvalUsageSummary;
  /** Blocking metric, check, and record failures for quick debugging. */
  gateFailures?: EvalGateFailureSummary[];
  /** Failed example aggregates, including flaky repeated examples. */
  failedExamples?: EvalFailedExampleSummary[];
  /** Repetition-based flake classification. */
  flakes?: EvalFlakeSummary;
}

/** JSON-serializable report produced by `runEval`. */
export interface EvalReport {
  kind: "eval-report";
  /** Additive report contract version. Missing means legacy V1 report. */
  schemaVersion?: number;
  runId: string;
  definitionId: string;
  targetKind: EvalTargetKind;
  target: string;
  dataset?: EvalReportDatasetMetadata;
  startedAt: string;
  endedAt: string;
  summary: EvalReportSummary;
  records: EvalRecord[];
  exports?: EvalReportExportResult[];
  metadata?: EvalReportMetadata;
}
