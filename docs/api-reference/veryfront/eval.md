---
title: "veryfront/eval"
description: "First-class eval primitives for agent quality checks."
order: 7
---

## Import

```ts
import {
  compareEvalModelReports,
  compareEvalReports,
  createEvalDatasetMetadata,
  createEvalModelComparisonMarkdown,
  createEvalReport,
  createEvalRunId,
} from "veryfront/eval";
```

## Examples

```ts
import { datasets, evalAgent, metrics } from "veryfront/eval";

export default evalAgent({
  target: "agent:researcher",
  dataset: datasets.inline([
    { id: "q1", input: "Capital of France?", reference: "Paris" },
  ]),
  metrics: [
    metrics.answer.contains({ text: "Paris" }).gate(),
    metrics.agent.calledTool("search_docs").gate(),
    metrics.agent.noFailedTools().gate(),
  ],
});
```

### Live agent-service eval

```ts
import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
import { createAgentServiceEvalAdapter } from "veryfront/eval/agent-service";

const definition = evalAgent({
  target: "agent:veryfront",
  dataset: datasets.inline([{ id: "smoke", input: "List project files." }]),
  metrics: [metrics.agent.noFailedTools().gate()],
});

const report = await runEval(definition, {
  adapters: {
    agent: createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:3001/api/ag-ui",
      authToken: "<TOKEN>",
      projectId: "<PROJECT_ID>",
    }),
  },
});
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `EVAL_REPORT_SCHEMA_VERSION` | Additive eval report contract version written by new reports and summary artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L20) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compareEvalModelReports` | Compare eval reports from multiple models using conservative promotion rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts#L612) |
| `compareEvalReports` | Compare a current eval report against a saved baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/baseline.ts#L192) |
| `createEvalDatasetMetadata` | Create stable dataset metadata for report consumers and CI artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L70) |
| `createEvalModelComparisonMarkdown` | Render a human-reviewable markdown summary for a model comparison report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts#L663) |
| `createEvalReport` | Create a JSON-serializable eval report from executed records. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L325) |
| `createEvalRunId` | Create a timestamp-sortable eval run id with a collision-resistant suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/run-id.ts#L7) |
| `createEvalRunProvenance` | Build stable provenance metadata from explicit git/cloud inputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts#L131) |
| `createEvalSourceDocument` | Create the normalized Eval document Studio can list, inspect, and edit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L311) |
| `deriveEvalId` | Derive the stable `eval:<path>` ID for an eval file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L77) |
| `discoverEvals` | Discover eval definitions from a project eval directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L152) |
| `evalAgent` | Define an eval that targets a Veryfront agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L59) |
| `evalTool` | Define an eval that targets a Veryfront tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L64) |
| `exportEvalReport` | Export an eval report through the configured eval report exporter registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L298) |
| `findEvalById` | Discover and return one eval definition by ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L195) |
| `isEvalDefinition` | Check whether a value is a normalized eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L69) |
| `resolveEvalRunProvenance` | Resolve local or Cloud provenance for an eval run without failing the eval if git metadata is unavailable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts#L246) |
| `runEval` | Execute an eval locally with injected target adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L419) |
| `summarizeEvalRecords` | Summarize eval records into pass/fail and metric aggregates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L302) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateEvalSourceDocumentOptions` | Options for creating a Studio source document from a discovered eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L251) |
| `DiscoveredEval` | Eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L22) |
| `EvalAgentAdapter` | Adapter used by `runEval` to execute V1 agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L460) |
| `EvalAgentAdapterContext` | Context passed to an agent adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L439) |
| `EvalAgentAdapterResult` | Agent adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L446) |
| `EvalAgentInput` | Input accepted by `evalAgent`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L405) |
| `EvalAnswerGroundednessMetricOptions` | Options for judge-backed answer grounding checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L230) |
| `EvalBudgetDeltaSummary` | Numeric budget delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L602) |
| `EvalCheckContext` | Context passed to an eval definition's `check` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L356) |
| `EvalCitation` | Citation emitted by an answer and matched against retrieved or expected sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L257) |
| `EvalDataset` | Dataset loader used by an eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L130) |
| `EvalDatasetLoadContext` | Context passed to dataset loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L125) |
| `EvalDefinition` | First-class eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L386) |
| `EvalDiscoveryOptions` | Options for project-local eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L37) |
| `EvalDiscoveryResult` | Result returned by eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L47) |
| `EvalDurationSummary` | Duration aggregate for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L523) |
| `EvalEditableField` | Form-editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L240) |
| `EvalExample` | Normalized dataset example used by eval runners and reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L109) |
| `EvalExampleInput` | Dataset example shape accepted by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L117) |
| `EvalExpect` | Built-in expectation helpers available inside `check`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L346) |
| `EvalExpectation` | Fluent severity helpers for `check` expectations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L339) |
| `EvalFailedExampleSummary` | Per-example failure aggregate included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L570) |
| `EvalFlakeSummary` | Flake classification for repeated eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L580) |
| `EvalGateFailureSummary` | Blocking failure included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L558) |
| `EvalKnowledgeCitationMetricOptions` | Options for citation precision and recall over retrieved knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L221) |
| `EvalKnowledgeExpectedSource` | Expected knowledge source or passage for retrieval-quality metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L191) |
| `EvalKnowledgeMrrMetricOptions` | Options for mean reciprocal rank over retrieved knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L213) |
| `EvalKnowledgeRetrievalMetricOptions` | Options shared by knowledge retrieval metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L205) |
| `EvalLlmGroundednessJudgeOptions` | Options for the built-in LLM groundedness judge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts#L9) |
| `EvalMetric` | Metric contract used by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L326) |
| `EvalMetricContext` | Optional runtime context passed to metric evaluators. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L321) |
| `EvalMetricDeltaSummary` | Per-metric delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L588) |
| `EvalMetricFamily` | Metric family used for grouping report summaries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L15) |
| `EvalMetricResult` | Result emitted by a metric or check assertion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L308) |
| `EvalMetricSummary` | Aggregate pass/fail summary for one metric. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L512) |
| `EvalMetricThreshold` | Numeric threshold attached to score-based metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L18) |
| `EvalMockTools` | Static or request-scoped mock tools for local `evalAgent` execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L377) |
| `EvalMockToolsResolver` | Request-scoped mock tool resolver for local `evalAgent` execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L372) |
| `EvalMockToolsResolverContext` | Context passed to an agent eval mock tool resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L365) |
| `EvalModelCandidateComparison` | Candidate-vs-baseline comparison used to decide whether a model is promotable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L709) |
| `EvalModelComparison` | Aggregate report for comparing one baseline model against candidate models. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L732) |
| `EvalModelComparisonConstraint` | Hard model comparison eligibility constraint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L768) |
| `EvalModelComparisonDecision` | Conservative model comparison recommendation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L726) |
| `EvalModelComparisonMetricName` | Metric names available to model comparison constraints and objectives. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L746) |
| `EvalModelComparisonObjective` | Weighted model comparison objective used to rank eligible candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L775) |
| `EvalModelComparisonOptions` | Promotion thresholds for model comparison. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L781) |
| `EvalModelReportSummary` | Per-model row in an eval model comparison report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L678) |
| `EvalRecord` | One executed example and repetition inside an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L286) |
| `EvalReport` | JSON-serializable report produced by `runEval`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L813) |
| `EvalReportComparison` | Baseline comparison for a current eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L623) |
| `EvalReportComparisonPolicy` | Regression policy for comparing a current eval report to a saved baseline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L614) |
| `EvalReportDatasetMetadata` | Stable dataset identity attached to new eval reports when examples are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L670) |
| `EvalReportExportConfig` | Export configuration for a completed eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L503) |
| `EvalReportMetadata` | Additional report metadata that should not affect pass/fail semantics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L664) |
| `EvalReportSummary` | Aggregate pass/fail summary for one eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L792) |
| `EvalRetrievedContext` | Retrieved context item captured for deterministic RAG metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L245) |
| `EvalRun` | V2-ready Eval run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L248) |
| `EvalRunProvenance` | Runtime and source identity attached to an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L638) |
| `EvalSeverity` | How a metric result affects the final eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L12) |
| `EvalSource` | Source location for a discovered eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L380) |
| `EvalSourceDocument` | Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L244) |
| `EvalSourcePatch` | Eval source patch submitted by Studio forms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L246) |
| `EvalSourceReference` | Source location for an Eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L242) |
| `EvalStudioCapability` | Capability string Studio uses for Eval source and run actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L238) |
| `EvalTargetKind` | Primitive kind an eval can execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L9) |
| `EvalToolAdapter` | Adapter used by `runEval` to execute tool targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L485) |
| `EvalToolAdapterContext` | Context passed to a tool adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L465) |
| `EvalToolAdapterResult` | Tool adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L474) |
| `EvalToolCall` | Tool call metadata captured during one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L269) |
| `EvalToolCallCountOptions` | Options for checking how often a tool was called. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L184) |
| `EvalToolCallMatchOptions` | Options for matching a required tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L178) |
| `EvalToolCallStatus` | Normalized status for a tool call captured during an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L172) |
| `EvalToolInput` | Input accepted by `evalTool`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L420) |
| `EvalToolInputMatchMode` | How expected tool input is compared to the captured tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L175) |
| `EvalTrace` | Trace metadata captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L280) |
| `EvalUsage` | Token and cost usage captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L147) |
| `EvalUsageSummary` | Usage totals for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L533) |
| `RunEvalOptions` | Options for running an eval locally. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L490) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `datasets` | Dataset factories for inline, JSON, and JSONL eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/datasets.ts#L40) |
| `getEvalEditableFieldSchema` | Schema for an editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L14) |
| `getEvalRunSchema` | Schema for V2-ready Eval run projections. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L206) |
| `getEvalSourceDocumentSchema` | Schema for a Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L166) |
| `getEvalSourcePatchSchema` | Schema for a source patch submitted from an Eval editor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L187) |
| `getEvalSourceReferenceSchema` | Schema for an Eval source reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L32) |
| `getEvalStudioCapabilitySchema` | Schema for Eval Studio capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L6) |
| `getEvalTargetKindSchema` | Schema for an Eval target primitive kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L11) |
| `judges` | Built-in judge factories for semantic eval metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts#L259) |
| `metrics` | Metric factories for deterministic answers, agent behavior, operations, and judges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/metrics.ts#L704) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/eval/agent-service`

```ts
import { assertCompleted, assertNoMalformedCreateFileToolCalls, buildAgentServiceEvalRequestBody } from "veryfront/eval/agent-service";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT` | Default local AG-UI endpoint used by agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L21) |
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` | Default value for durable run canary timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L15) |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` | Default value for live eval area tag rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L36) |
| `DEFAULT_LIVE_EVAL_ENDPOINT` | Default value for live eval endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L16) |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` | Default value for live eval optional judge case prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L29) |
| `DURABLE_RUN_TOKEN_GROWTH_CANARY_MARKER` | Marker used by the durable run token-growth canary prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L10) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCompleted` | Assert that a durable run canary completed successfully. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L32) |
| `assertNoMalformedCreateFileToolCalls` | Assert no malformed create file tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L81) |
| `buildAgentServiceEvalRequestBody` | Build the AG-UI request body for a single eval example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L522) |
| `buildFailureSuffix` | Builds failure suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L79) |
| `buildLiveEvalCaseMetadata` | Builds live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L121) |
| `buildLiveEvalCaseTagSummary` | Builds live eval case tag summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L41) |
| `buildLiveEvalRequestBody` | Builds live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L32) |
| `buildLiveEvalRuntimeSummary` | Builds live eval runtime summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L137) |
| `buildLiveEvalStatusSummary` | Builds live eval status summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L152) |
| `buildProgressLine` | Builds progress line. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L58) |
| `buildRuntimePerformanceSummary` | Builds runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L36) |
| `cancelLiveEvalInputRequest` | Request payload for cancel live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L589) |
| `collectAssistantText` | Collect assistant text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L73) |
| `containsOrderedSubsequence` | Contains ordered subsequence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L92) |
| `containsSkillLoad` | Contains skill load helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L483) |
| `countStepStartedEvents` | Count step started events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L488) |
| `createAgentServiceEvalAdapter` | Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L552) |
| `createDurableRunCanaryApiClient` | Create durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L259) |
| `createDurableRunCanaryRunner` | Create durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L538) |
| `createDurableRunTokenGrowthCanaryCase` | Create a two-turn durable run canary for historical tool-input token growth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L38) |
| `createFailedEvalResult` | Result returned from create failed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L79) |
| `createLiveEvalApiClient` | Create live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L271) |
| `createLiveEvalCaseSupport` | Create live eval case support. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L493) |
| `createLiveEvalConversation` | Create live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L287) |
| `createLiveEvalProjectUploadFixture` | Create live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L342) |
| `createLiveEvalRelease` | Create live eval release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L440) |
| `createPassedEvalResult` | Result returned from create passed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L97) |
| `createPlainTextPdf` | Create plain text pdf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L11) |
| `createSkippedEvalResult` | Result returned from create skipped eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L61) |
| `deleteLiveEvalConversation` | Delete live eval conversation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L318) |
| `deleteLiveEvalProjectFile` | Delete live eval project file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L475) |
| `evaluateAgentServiceEvalEnvironment` | Evaluate whether the required live agent-service eval environment is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L501) |
| `evaluateRuntimeConfidenceEnv` | Evaluate runtime confidence env helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L13) |
| `findAssistantMessage` | Message shape for find assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L43) |
| `getLiveEvalProjectFile` | Return live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L406) |
| `hasEveryLiveEvalTag` | Check whether every live eval tag is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L27) |
| `hasFinished` | Check whether finished is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L478) |
| `listOpenLiveEvalInputRequests` | List open live eval input requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L503) |
| `parseDurableRunCanaryRunSummary` | Parses durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L113) |
| `printRuntimeConfidencePreflight` | Print runtime confidence preflight helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L39) |
| `resolveAgentServiceEvalEnvironment` | Resolve environment values for live agent-service eval execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L476) |
| `resolveDurableRunCanaryEnvironment` | Resolves durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L18) |
| `resolveLiveEvalEnvironment` | Resolves live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L19) |
| `resolveLiveEvalRequestedCaseIds` | Resolves live eval requested case IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L88) |
| `runDurableRunCanaryCli` | Run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L46) |
| `runLiveEvalCli` | Run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L85) |
| `selectLiveEvalCases` | Select live eval cases helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L61) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L60) |
| `submitLiveEvalInputResponse` | Response payload for submit live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L562) |
| `waitForOpenLiveEvalInputRequest` | Request payload for wait for open live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L531) |
| `withLiveEvalMetadata` | Applies live eval metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L160) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceEvalAdapterConfig` | Configuration for the live agent-service eval adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L93) |
| `AgentServiceEvalEnvironment` | Resolved environment values for live agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L27) |
| `AgentServiceEvalEnvironmentInput` | Environment input accepted by agent-service eval helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L24) |
| `AgentServiceEvalEnvironmentPreflightResult` | Preflight result for a live agent-service eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L38) |
| `AgentServiceEvalForwardedProps` | Veryfront forwarded props included in an AG-UI eval request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L45) |
| `AgentServiceEvalRequestBody` | AG-UI request body sent to an agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L73) |
| `BuildAgentServiceEvalRequestBodyInput` | Input accepted by `buildAgentServiceEvalRequestBody`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L58) |
| `BuildLiveEvalCaseMetadataInput` | Input payload for build live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L22) |
| `BuildLiveEvalRequestBodyInput` | Input payload for build live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L18) |
| `DurableRunCanaryApiClient` | Public API contract for durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L248) |
| `DurableRunCanaryApiConfig` | Configuration used by durable run canary API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L9) |
| `DurableRunCanaryCase` | Public API contract for durable run canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L372) |
| `DurableRunCanaryCliCaseFactoryInput` | Input payload for durable run canary cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L16) |
| `DurableRunCanaryCreateRootRunInput` | Input payload for durable run canary create root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L20) |
| `DurableRunCanaryEnvironment` | Public API contract for durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L6) |
| `DurableRunCanaryMessage` | Message shape for durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L49) |
| `DurableRunCanaryPreparedCase` | Public API contract for durable run canary prepared case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L357) |
| `DurableRunCanaryResult` | Result returned from durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L345) |
| `DurableRunCanaryRunnerConfig` | Configuration used by durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L379) |
| `DurableRunCanaryRunSummary` | Public API contract for durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L54) |
| `DurableRunCanarySendUserMessageInput` | Input payload for durable run canary send user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L26) |
| `DurableRunCanaryStartRunInput` | Input payload for durable run canary start run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L32) |
| `DurableRunTokenGrowthCanaryCaseInput` | Input payload for create durable run token-growth canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L13) |
| `LiveEvalApiClient` | Public API contract for live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L122) |
| `LiveEvalApiContext` | Context for live eval API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L10) |
| `LiveEvalCase` | Public API contract for live eval case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L36) |
| `LiveEvalCaseMetadata` | Public API contract for live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L4) |
| `LiveEvalCaseMetadataOptions` | Options accepted by live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L15) |
| `LiveEvalCaseSelectionInput` | Input payload for live eval case selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L15) |
| `LiveEvalCaseSurface` | Public API contract for live eval case surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L4) |
| `LiveEvalCaseTagRule` | Public API contract for live eval case tag rule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L7) |
| `LiveEvalCliCaseFactoryInput` | Input payload for live eval cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L33) |
| `LiveEvalCliCaseGroups` | Public API contract for live eval cli case groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L26) |
| `LiveEvalContext` | Context for live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L29) |
| `LiveEvalConversationInput` | Input payload for live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L28) |
| `LiveEvalCreateConversationInput` | Input payload for live eval create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L23) |
| `LiveEvalCreateReleaseInput` | Input payload for live eval create release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L48) |
| `LiveEvalEnvironment` | Public API contract for live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L6) |
| `LiveEvalInputRequestInput` | Input payload for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L72) |
| `LiveEvalInputRequestRecord` | Record shape for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L117) |
| `LiveEvalInputResponseValues` | Public API contract for live eval input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L60) |
| `LiveEvalProjectFile` | Public API contract for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L60) |
| `LiveEvalProjectFileInput` | Input payload for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L43) |
| `LiveEvalProjectFileReaderInput` | Input payload for live eval project file reader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L66) |
| `LiveEvalProjectUploadFixtureInput` | Input payload for live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L33) |
| `LiveEvalRequestBody` | Public API contract for live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L1) |
| `LiveEvalRequestTimeoutInput` | Input payload for live eval request timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L18) |
| `LiveEvalResultForPerformance` | Public API contract for live eval result for performance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L4) |
| `LiveEvalResultForReport` | Public API contract for live eval result for report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L9) |
| `LiveEvalResultRecord` | Record shape for live eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L3) |
| `LiveEvalRunnerConfig` | Configuration used by live eval runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L72) |
| `LiveEvalRuntime` | Public API contract for live eval runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L1) |
| `LiveEvalSubmitInputResponseInput` | Input payload for live eval submit input response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L65) |
| `LiveEvalWaitForOpenInputRequestInput` | Input payload for live eval wait for open input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L53) |
| `PreparedLiveEvalInput` | Input payload for prepared live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L20) |
| `RunDurableRunCanaryCliInput` | Input payload for run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L22) |
| `RunLiveEvalCliInput` | Input payload for run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L50) |
| `RuntimeConfidencePreflightResult` | Result returned from runtime confidence preflight. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L6) |
| `RuntimePerformanceSummary` | Public API contract for runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L10) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getDurableRunCanaryMessageSchema` | Zod schema for get durable run canary message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L39) |
