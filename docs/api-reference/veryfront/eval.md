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
| `EVAL_REPORT_SCHEMA_VERSION` | Additive eval report contract version written by new reports and summary artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L23) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compareEvalModelReports` | Compare eval reports from multiple models using conservative promotion rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts#L724) |
| `compareEvalReports` | Compare a current eval report against a saved baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/baseline.ts#L246) |
| `createEvalDatasetMetadata` | Create stable dataset metadata for report consumers and CI artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L215) |
| `createEvalModelComparisonMarkdown` | Render a human-reviewable markdown summary for a model comparison report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts#L789) |
| `createEvalReport` | Create a JSON-serializable eval report from executed records. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L481) |
| `createEvalRunId` | Create a timestamp-sortable eval run id with a collision-resistant suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/run-id.ts#L28) |
| `createEvalRunProvenance` | Build stable provenance metadata from explicit git/cloud inputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts#L144) |
| `createEvalSourceDocument` | Create the normalized Eval document Studio can list, inspect, and edit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L326) |
| `deriveEvalId` | Derive the stable `eval:<path>` ID for an eval file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L79) |
| `discoverEvals` | Discover eval definitions from a project eval directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L154) |
| `evalAgent` | Define an eval that targets a Veryfront agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L157) |
| `evalTool` | Define an eval that targets a Veryfront tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L162) |
| `exportEvalReport` | Export an eval report through the configured eval report exporter registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L581) |
| `findEvalById` | Discover and return one eval definition by ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L208) |
| `isEvalDefinition` | Check whether a value is a normalized eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L167) |
| `resolveEvalRunProvenance` | Resolve local or Cloud provenance for an eval run without failing the eval if git metadata is unavailable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts#L280) |
| `runEval` | Execute an eval locally with injected target adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L719) |
| `summarizeEvalRecords` | Summarize eval records into pass/fail and metric aggregates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L457) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateEvalSourceDocumentOptions` | Options for creating a Studio source document from a discovered eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L266) |
| `DiscoveredEval` | Eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L24) |
| `EvalAgentAdapter` | Adapter used by `runEval` to execute V1 agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L448) |
| `EvalAgentAdapterContext` | Context passed to an agent adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L427) |
| `EvalAgentAdapterResult` | Agent adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L434) |
| `EvalAgentInput` | Input accepted by `evalAgent`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L394) |
| `EvalAnswerGroundednessMetricOptions` | Options for judge-backed answer grounding checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L235) |
| `EvalBudgetDeltaSummary` | Numeric budget delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L588) |
| `EvalCheckContext` | Context passed to an eval definition's `check` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L361) |
| `EvalCitation` | Citation emitted by an answer and matched against retrieved or expected sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L262) |
| `EvalDataset` | Dataset loader used by an eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L135) |
| `EvalDatasetLoadContext` | Context passed to dataset loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L130) |
| `EvalDefinition` | First-class eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L376) |
| `EvalDiscoveryOptions` | Options for project-local eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L39) |
| `EvalDiscoveryResult` | Result returned by eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L49) |
| `EvalDurationSummary` | Duration aggregate for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L509) |
| `EvalEditableField` | Form-editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L255) |
| `EvalExample` | Normalized dataset example used by eval runners and reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L114) |
| `EvalExampleInput` | Dataset example shape accepted by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L122) |
| `EvalExpect` | Built-in expectation helpers available inside `check`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L351) |
| `EvalExpectation` | Fluent severity helpers for `check` expectations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L344) |
| `EvalFailedExampleSummary` | Per-example failure aggregate included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L556) |
| `EvalFlakeSummary` | Flake classification for repeated eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L566) |
| `EvalGateFailureSummary` | Blocking failure included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L544) |
| `EvalKnowledgeCitationMetricOptions` | Options for citation precision and recall over retrieved knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L226) |
| `EvalKnowledgeExpectedSource` | Expected knowledge source or passage for retrieval-quality metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L196) |
| `EvalKnowledgeMrrMetricOptions` | Options for mean reciprocal rank over retrieved knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L218) |
| `EvalKnowledgeRetrievalMetricOptions` | Options shared by knowledge retrieval metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L210) |
| `EvalLlmGroundednessJudgeOptions` | Options for the built-in LLM groundedness judge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts#L11) |
| `EvalMetric` | Metric contract used by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L331) |
| `EvalMetricContext` | Optional runtime context passed to metric evaluators. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L326) |
| `EvalMetricDeltaSummary` | Per-metric delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L574) |
| `EvalMetricFamily` | Metric family used for grouping report summaries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L14) |
| `EvalMetricResult` | Result emitted by a metric or check assertion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L313) |
| `EvalMetricSummary` | Aggregate pass/fail summary for one metric. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L498) |
| `EvalMetricThreshold` | Numeric threshold attached to score-based metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L17) |
| `EvalModelCandidateComparison` | Candidate-vs-baseline comparison used to decide whether a model is promotable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L695) |
| `EvalModelComparison` | Aggregate report for comparing one baseline model against candidate models. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L718) |
| `EvalModelComparisonConstraint` | Hard model comparison eligibility constraint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L754) |
| `EvalModelComparisonDecision` | Conservative model comparison recommendation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L712) |
| `EvalModelComparisonMetricName` | Metric names available to model comparison constraints and objectives. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L732) |
| `EvalModelComparisonObjective` | Weighted model comparison objective used to rank eligible candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L761) |
| `EvalModelComparisonOptions` | Promotion thresholds for model comparison. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L767) |
| `EvalModelReportSummary` | Per-model row in an eval model comparison report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L664) |
| `EvalRecord` | One executed example and repetition inside an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L291) |
| `EvalReport` | JSON-serializable report produced by `runEval`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L799) |
| `EvalReportComparison` | Baseline comparison for a current eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L609) |
| `EvalReportComparisonPolicy` | Regression policy for comparing a current eval report to a saved baseline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L600) |
| `EvalReportDatasetMetadata` | Stable dataset identity attached to new eval reports when examples are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L656) |
| `EvalReportExportConfig` | Export configuration for a completed eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L491) |
| `EvalReportMetadata` | Additional report metadata that should not affect pass/fail semantics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L650) |
| `EvalReportSummary` | Aggregate pass/fail summary for one eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L778) |
| `EvalRetrievedContext` | Retrieved context item captured for deterministic RAG metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L250) |
| `EvalRun` | V2-ready Eval run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L263) |
| `EvalRunProvenance` | Runtime and source identity attached to an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L624) |
| `EvalSeverity` | How a metric result affects the final eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L11) |
| `EvalSource` | Source location for a discovered eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L370) |
| `EvalSourceDocument` | Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L259) |
| `EvalSourcePatch` | Eval source patch submitted by Studio forms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L261) |
| `EvalSourceReference` | Source location for an Eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L257) |
| `EvalStudioCapability` | Capability string Studio uses for Eval source and run actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L253) |
| `EvalTargetKind` | Primitive kind an eval can execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L8) |
| `EvalToolAdapter` | Adapter used by `runEval` to execute tool targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L473) |
| `EvalToolAdapterContext` | Context passed to a tool adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L453) |
| `EvalToolAdapterResult` | Tool adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L462) |
| `EvalToolCall` | Tool call metadata captured during one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L274) |
| `EvalToolCallCountOptions` | Options for checking how often a tool was called. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L189) |
| `EvalToolCallMatchOptions` | Options for matching a required tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L183) |
| `EvalToolCallStatus` | Normalized status for a tool call captured during an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L177) |
| `EvalToolInput` | Input accepted by `evalTool`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L408) |
| `EvalToolInputMatchMode` | How expected tool input is compared to the captured tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L180) |
| `EvalTrace` | Trace metadata captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L285) |
| `EvalUsage` | Token and cost usage captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L152) |
| `EvalUsageSummary` | Usage totals for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L519) |
| `RunEvalOptions` | Options for running an eval locally. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L478) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `datasets` | Dataset factories for inline, JSON, and JSONL eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/datasets.ts#L96) |
| `getEvalEditableFieldSchema` | Schema for an editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L23) |
| `getEvalRunSchema` | Schema for V2-ready Eval run projections. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L217) |
| `getEvalSourceDocumentSchema` | Schema for a Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L175) |
| `getEvalSourcePatchSchema` | Schema for a source patch submitted from an Eval editor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L196) |
| `getEvalSourceReferenceSchema` | Schema for an Eval source reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L41) |
| `getEvalStudioCapabilitySchema` | Schema for Eval Studio capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L15) |
| `getEvalTargetKindSchema` | Schema for an Eval target primitive kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L20) |
| `judges` | Built-in judge factories for semantic eval metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts#L297) |
| `metrics` | Metric factories for deterministic answers, agent behavior, operations, and judges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/metrics.ts#L947) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/eval/agent-service`

```ts
import { assertCompleted, assertNoMalformedCreateFileToolCalls, buildAgentServiceEvalRequestBody } from "veryfront/eval/agent-service";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT` | Default local AG-UI endpoint used by agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L68) |
| `DEFAULT_AGENT_SERVICE_EVAL_TIMEOUT_MS` | Default timeout for one agent-service eval request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L30) |
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` | Default value for durable run canary timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L16) |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` | Default value for live eval area tag rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L37) |
| `DEFAULT_LIVE_EVAL_ENDPOINT` | Default value for live eval endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L17) |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` | Default value for live eval optional judge case prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L30) |
| `DURABLE_RUN_TOKEN_GROWTH_CANARY_MARKER` | Marker used by the durable run token-growth canary prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L11) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCompleted` | Assert that a durable run canary completed successfully. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L33) |
| `assertNoMalformedCreateFileToolCalls` | Assert no malformed create file tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L82) |
| `buildAgentServiceEvalRequestBody` | Build the AG-UI request body for a single eval example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L590) |
| `buildFailureSuffix` | Builds failure suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L200) |
| `buildLiveEvalCaseMetadata` | Builds live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L122) |
| `buildLiveEvalCaseTagSummary` | Builds live eval case tag summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L63) |
| `buildLiveEvalRequestBody` | Builds live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L102) |
| `buildLiveEvalRuntimeSummary` | Builds live eval runtime summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L169) |
| `buildLiveEvalStatusSummary` | Builds live eval status summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L184) |
| `buildProgressLine` | Builds progress line. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L175) |
| `buildRuntimePerformanceSummary` | Builds runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L41) |
| `cancelLiveEvalInputRequest` | Request payload for cancel live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L685) |
| `collectAssistantText` | Collect assistant text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L74) |
| `containsOrderedSubsequence` | Contains ordered subsequence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L213) |
| `containsSkillLoad` | Contains skill load helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L521) |
| `countStepStartedEvents` | Count step started events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L526) |
| `createAgentServiceEvalAdapter` | Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L641) |
| `createDurableRunCanaryApiClient` | Create durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L281) |
| `createDurableRunCanaryRunner` | Create durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L592) |
| `createDurableRunTokenGrowthCanaryCase` | Create a two-turn durable run canary for historical tool-input token growth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L39) |
| `createFailedEvalResult` | Result returned from create failed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L104) |
| `createLiveEvalApiClient` | Create live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L322) |
| `createLiveEvalCaseSupport` | Create live eval case support. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L531) |
| `createLiveEvalConversation` | Create live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L338) |
| `createLiveEvalProjectUploadFixture` | Create live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L395) |
| `createLiveEvalRelease` | Create live eval release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L507) |
| `createPassedEvalResult` | Result returned from create passed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L122) |
| `createPlainTextPdf` | Create plain text pdf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L99) |
| `createSkippedEvalResult` | Result returned from create skipped eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L83) |
| `deleteLiveEvalConversation` | Delete live eval conversation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L369) |
| `deleteLiveEvalProjectFile` | Delete live eval project file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L549) |
| `evaluateAgentServiceEvalEnvironment` | Evaluate whether the required live agent-service eval environment is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L569) |
| `evaluateRuntimeConfidenceEnv` | Evaluate runtime confidence env helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L15) |
| `findAssistantMessage` | Message shape for find assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L44) |
| `getLiveEvalProjectFile` | Return live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L465) |
| `hasEveryLiveEvalTag` | Check whether every live eval tag is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L49) |
| `hasFinished` | Check whether finished is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L515) |
| `listOpenLiveEvalInputRequests` | List open live eval input requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L583) |
| `parseDurableRunCanaryRunSummary` | Parses durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L135) |
| `printRuntimeConfidencePreflight` | Print runtime confidence preflight helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L43) |
| `resolveAgentServiceEvalEnvironment` | Resolve environment values for live agent-service eval execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L544) |
| `resolveDurableRunCanaryEnvironment` | Resolves durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L19) |
| `resolveLiveEvalEnvironment` | Resolves live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L20) |
| `resolveLiveEvalRequestedCaseIds` | Resolves live eval requested case IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L118) |
| `runDurableRunCanaryCli` | Run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L48) |
| `runLiveEvalCli` | Run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L87) |
| `selectLiveEvalCases` | Select live eval cases helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L83) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L61) |
| `submitLiveEvalInputResponse` | Response payload for submit live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L656) |
| `waitForOpenLiveEvalInputRequest` | Request payload for wait for open live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L614) |
| `withLiveEvalMetadata` | Applies live eval metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L161) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceEvalAdapterConfig` | Configuration for the live agent-service eval adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L154) |
| `AgentServiceEvalEnvironment` | Resolved environment values for live agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L74) |
| `AgentServiceEvalEnvironmentInput` | Environment input accepted by agent-service eval helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L71) |
| `AgentServiceEvalEnvironmentPreflightResult` | Preflight result for a live agent-service eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L85) |
| `AgentServiceEvalForwardedProps` | Veryfront forwarded props included in an AG-UI eval request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L92) |
| `AgentServiceEvalRequestBody` | AG-UI request body sent to an agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L120) |
| `BuildAgentServiceEvalRequestBodyInput` | Input accepted by `buildAgentServiceEvalRequestBody`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L105) |
| `BuildLiveEvalCaseMetadataInput` | Input payload for build live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L23) |
| `BuildLiveEvalRequestBodyInput` | Input payload for build live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L88) |
| `DurableRunCanaryApiClient` | Public API contract for durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L270) |
| `DurableRunCanaryApiConfig` | Configuration used by durable run canary API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L27) |
| `DurableRunCanaryCase` | Public API contract for durable run canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L407) |
| `DurableRunCanaryCliCaseFactoryInput` | Input payload for durable run canary cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L18) |
| `DurableRunCanaryCreateRootRunInput` | Input payload for durable run canary create root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L38) |
| `DurableRunCanaryEnvironment` | Public API contract for durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L7) |
| `DurableRunCanaryMessage` | Message shape for durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L71) |
| `DurableRunCanaryPreparedCase` | Public API contract for durable run canary prepared case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L392) |
| `DurableRunCanaryResult` | Result returned from durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L380) |
| `DurableRunCanaryRunnerConfig` | Configuration used by durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L414) |
| `DurableRunCanaryRunSummary` | Public API contract for durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L76) |
| `DurableRunCanarySendUserMessageInput` | Input payload for durable run canary send user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L44) |
| `DurableRunCanaryStartRunInput` | Input payload for durable run canary start run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L50) |
| `DurableRunTokenGrowthCanaryCaseInput` | Input payload for create durable run token-growth canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L14) |
| `LiveEvalApiClient` | Public API contract for live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L136) |
| `LiveEvalApiContext` | Context for live eval API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L23) |
| `LiveEvalCase` | Public API contract for live eval case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L43) |
| `LiveEvalCaseMetadata` | Public API contract for live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L26) |
| `LiveEvalCaseMetadataOptions` | Options accepted by live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L16) |
| `LiveEvalCaseSelectionInput` | Input payload for live eval case selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L37) |
| `LiveEvalCaseSurface` | Public API contract for live eval case surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L5) |
| `LiveEvalCaseTagRule` | Public API contract for live eval case tag rule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L8) |
| `LiveEvalCliCaseFactoryInput` | Input payload for live eval cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L35) |
| `LiveEvalCliCaseGroups` | Public API contract for live eval cli case groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L28) |
| `LiveEvalContext` | Context for live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L36) |
| `LiveEvalConversationInput` | Input payload for live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L42) |
| `LiveEvalCreateConversationInput` | Input payload for live eval create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L37) |
| `LiveEvalCreateReleaseInput` | Input payload for live eval create release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L62) |
| `LiveEvalEnvironment` | Public API contract for live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L7) |
| `LiveEvalInputRequestInput` | Input payload for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L86) |
| `LiveEvalInputRequestRecord` | Record shape for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L131) |
| `LiveEvalInputResponseValues` | Public API contract for live eval input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L74) |
| `LiveEvalProjectFile` | Public API contract for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L67) |
| `LiveEvalProjectFileInput` | Input payload for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L57) |
| `LiveEvalProjectFileReaderInput` | Input payload for live eval project file reader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L73) |
| `LiveEvalProjectUploadFixtureInput` | Input payload for live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L47) |
| `LiveEvalRequestBody` | Public API contract for live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L71) |
| `LiveEvalRequestTimeoutInput` | Input payload for live eval request timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L31) |
| `LiveEvalResultForPerformance` | Public API contract for live eval result for performance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L9) |
| `LiveEvalResultForReport` | Public API contract for live eval result for report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L31) |
| `LiveEvalResultRecord` | Record shape for live eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L5) |
| `LiveEvalRunnerConfig` | Configuration used by live eval runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L79) |
| `LiveEvalRuntime` | Public API contract for live eval runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L6) |
| `LiveEvalSubmitInputResponseInput` | Input payload for live eval submit input response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L79) |
| `LiveEvalWaitForOpenInputRequestInput` | Input payload for live eval wait for open input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L67) |
| `PreparedLiveEvalInput` | Input payload for prepared live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L27) |
| `RunDurableRunCanaryCliInput` | Input payload for run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L24) |
| `RunLiveEvalCliInput` | Input payload for run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L52) |
| `RuntimeConfidencePreflightResult` | Result returned from runtime confidence preflight. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L8) |
| `RuntimePerformanceSummary` | Public API contract for runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L15) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `durableRunCanaryRunnerInternals` | White-box helpers used by durable run canary tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L808) |
| `getDurableRunCanaryMessageSchema` | Zod schema for get durable run canary message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L57) |
| `liveEvalRunnerInternals` | White-box helpers used by live eval runner tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L742) |
