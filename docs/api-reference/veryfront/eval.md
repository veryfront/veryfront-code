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
  createEvalModelComparisonMarkdown,
  createEvalReport,
  createEvalRunId,
  createEvalRunProvenance,
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

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compareEvalModelReports` | Compare eval reports from multiple models using conservative promotion rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts#L612) |
| `compareEvalReports` | Compare a current eval report against a saved baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/baseline.ts#L190) |
| `createEvalModelComparisonMarkdown` | Render a human-reviewable markdown summary for a model comparison report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts#L663) |
| `createEvalReport` | Create a JSON-serializable eval report from executed records. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L279) |
| `createEvalRunId` | Create a timestamp-sortable eval run id with a collision-resistant suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/run-id.ts#L8) |
| `createEvalRunProvenance` | Build stable provenance metadata from explicit git/cloud inputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts#L131) |
| `createEvalSourceDocument` | Create the normalized Eval document Studio can list, inspect, and edit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L308) |
| `deriveEvalId` | Derive the stable `eval:<path>` ID for an eval file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L78) |
| `discoverEvals` | Discover eval definitions from a project eval directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L153) |
| `evalAgent` | Define a V1 eval that targets a Veryfront agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L27) |
| `exportEvalReport` | Export an eval report through the configured eval report exporter registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L196) |
| `findEvalById` | Discover and return one eval definition by ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L196) |
| `isEvalDefinition` | Check whether a value is a normalized eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L49) |
| `resolveEvalRunProvenance` | Resolve local or Cloud provenance for an eval run without failing the eval if git metadata is unavailable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts#L259) |
| `runEval` | Execute an eval locally with injected target adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L283) |
| `summarizeEvalRecords` | Summarize eval records into pass/fail and metric aggregates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L256) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateEvalSourceDocumentOptions` | Options for creating a Studio source document from a discovered eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L248) |
| `DiscoveredEval` | Eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L23) |
| `EvalAgentAdapter` | Adapter used by `runEval` to execute V1 agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L345) |
| `EvalAgentAdapterContext` | Context passed to an agent adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L324) |
| `EvalAgentAdapterResult` | Agent adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L331) |
| `EvalAgentInput` | Input accepted by `evalAgent`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L310) |
| `EvalAnswerGroundednessMetricOptions` | Options for judge-backed answer grounding checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L153) |
| `EvalBudgetDeltaSummary` | Numeric budget delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L459) |
| `EvalCheckContext` | Context passed to an eval definition's `check` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L278) |
| `EvalCitation` | Citation emitted by an answer and matched against retrieved or expected sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L180) |
| `EvalDataset` | Dataset loader used by an eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L53) |
| `EvalDatasetLoadContext` | Context passed to dataset loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L48) |
| `EvalDefinition` | First-class eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L293) |
| `EvalDiscoveryOptions` | Options for project-local eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L38) |
| `EvalDiscoveryResult` | Result returned by eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L48) |
| `EvalDurationSummary` | Duration aggregate for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L380) |
| `EvalEditableField` | Form-editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L237) |
| `EvalExample` | Normalized dataset example used by eval runners and reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L32) |
| `EvalExampleInput` | Dataset example shape accepted by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L40) |
| `EvalExpect` | Built-in expectation helpers available inside `check`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L268) |
| `EvalExpectation` | Fluent severity helpers for `check` expectations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L261) |
| `EvalFailedExampleSummary` | Per-example failure aggregate included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L427) |
| `EvalFlakeSummary` | Flake classification for repeated eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L437) |
| `EvalGateFailureSummary` | Blocking failure included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L415) |
| `EvalKnowledgeCitationMetricOptions` | Options for citation precision and recall over retrieved knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L144) |
| `EvalKnowledgeExpectedSource` | Expected knowledge source or passage for retrieval-quality metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L114) |
| `EvalKnowledgeMrrMetricOptions` | Options for mean reciprocal rank over retrieved knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L136) |
| `EvalKnowledgeRetrievalMetricOptions` | Options shared by knowledge retrieval metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L128) |
| `EvalLlmGroundednessJudgeOptions` | Options for the built-in LLM groundedness judge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts#L10) |
| `EvalMetric` | Metric contract used by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L248) |
| `EvalMetricContext` | Optional runtime context passed to metric evaluators. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L243) |
| `EvalMetricDeltaSummary` | Per-metric delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L445) |
| `EvalMetricFamily` | Metric family used for grouping report summaries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L20) |
| `EvalMetricResult` | Result emitted by a metric or check assertion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L230) |
| `EvalMetricSummary` | Aggregate pass/fail summary for one metric. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L369) |
| `EvalMetricThreshold` | Numeric threshold attached to score-based metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L23) |
| `EvalModelCandidateComparison` | Candidate-vs-baseline comparison used to decide whether a model is promotable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L558) |
| `EvalModelComparison` | Aggregate report for comparing one baseline model against candidate models. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L581) |
| `EvalModelComparisonConstraint` | Hard model comparison eligibility constraint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L617) |
| `EvalModelComparisonDecision` | Conservative model comparison recommendation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L575) |
| `EvalModelComparisonMetricName` | Metric names available to model comparison constraints and objectives. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L595) |
| `EvalModelComparisonObjective` | Weighted model comparison objective used to rank eligible candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L624) |
| `EvalModelComparisonOptions` | Promotion thresholds for model comparison. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L630) |
| `EvalModelReportSummary` | Per-model row in an eval model comparison report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L527) |
| `EvalRecord` | One executed example and repetition inside an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L209) |
| `EvalReport` | JSON-serializable report produced by `runEval`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L662) |
| `EvalReportComparison` | Baseline comparison for a current eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L480) |
| `EvalReportComparisonPolicy` | Regression policy for comparing a current eval report to a saved baseline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L471) |
| `EvalReportExportConfig` | Export configuration for a completed eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L362) |
| `EvalReportMetadata` | Additional report metadata that should not affect pass/fail semantics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L521) |
| `EvalReportSummary` | Aggregate pass/fail summary for one eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L641) |
| `EvalRetrievedContext` | Retrieved context item captured for deterministic RAG metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L168) |
| `EvalRun` | V2-ready Eval run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L245) |
| `EvalRunProvenance` | Runtime and source identity attached to an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L495) |
| `EvalSeverity` | How a metric result affects the final eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L17) |
| `EvalSource` | Source location for a discovered eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L287) |
| `EvalSourceDocument` | Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L241) |
| `EvalSourcePatch` | Eval source patch submitted by Studio forms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L243) |
| `EvalSourceReference` | Source location for an Eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L239) |
| `EvalStudioCapability` | Capability string Studio uses for Eval source and run actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L235) |
| `EvalTargetKind` | Primitive kind an eval can execute. V1 supports agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L14) |
| `EvalToolCall` | Tool call metadata captured during one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L192) |
| `EvalToolCallCountOptions` | Options for checking how often a tool was called. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L107) |
| `EvalToolCallMatchOptions` | Options for matching a required tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L101) |
| `EvalToolCallStatus` | Normalized status for a tool call captured during an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L95) |
| `EvalToolInputMatchMode` | How expected tool input is compared to the captured tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L98) |
| `EvalTrace` | Trace metadata captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L203) |
| `EvalUsage` | Token and cost usage captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L70) |
| `EvalUsageSummary` | Usage totals for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L390) |
| `RunEvalOptions` | Options for running an eval locally. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L350) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `datasets` | Dataset factories for inline, JSON, and JSONL eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/datasets.ts#L41) |
| `getEvalEditableFieldSchema` | Schema for an editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L12) |
| `getEvalRunSchema` | Schema for V2-ready Eval run projections. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L203) |
| `getEvalSourceDocumentSchema` | Schema for a Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L163) |
| `getEvalSourcePatchSchema` | Schema for a source patch submitted from an Eval editor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L184) |
| `getEvalSourceReferenceSchema` | Schema for an Eval source reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L29) |
| `getEvalStudioCapabilitySchema` | Schema for Eval Studio capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L7) |
| `judges` | Built-in judge factories for semantic eval metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts#L260) |
| `metrics` | Metric factories for deterministic answers, agent behavior, operations, and judges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/metrics.ts#L691) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/eval/agent-service`

```ts
import { assertCompleted, assertNoMalformedCreateFileToolCalls, buildAgentServiceEvalRequestBody } from "veryfront/eval/agent-service";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT` | Default local AG-UI endpoint used by agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L22) |
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` | Default value for durable run canary timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L16) |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` | Default value for live eval area tag rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L37) |
| `DEFAULT_LIVE_EVAL_ENDPOINT` | Default value for live eval endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L17) |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` | Default value for live eval optional judge case prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L30) |
| `DURABLE_RUN_TOKEN_GROWTH_CANARY_MARKER` | Marker used by the durable run token-growth canary prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L10) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCompleted` | Assert that a durable run canary completed successfully. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L32) |
| `assertNoMalformedCreateFileToolCalls` | Assert no malformed create file tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L79) |
| `buildAgentServiceEvalRequestBody` | Build the AG-UI request body for a single eval example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L523) |
| `buildFailureSuffix` | Builds failure suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L80) |
| `buildLiveEvalCaseMetadata` | Builds live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L122) |
| `buildLiveEvalCaseTagSummary` | Builds live eval case tag summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L41) |
| `buildLiveEvalRequestBody` | Builds live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L33) |
| `buildLiveEvalRuntimeSummary` | Builds live eval runtime summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L137) |
| `buildLiveEvalStatusSummary` | Builds live eval status summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L152) |
| `buildProgressLine` | Builds progress line. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L59) |
| `buildRuntimePerformanceSummary` | Builds runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L37) |
| `cancelLiveEvalInputRequest` | Request payload for cancel live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L570) |
| `collectAssistantText` | Collect assistant text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L71) |
| `containsOrderedSubsequence` | Contains ordered subsequence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L93) |
| `containsSkillLoad` | Contains skill load helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L484) |
| `countStepStartedEvents` | Count step started events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L489) |
| `createAgentServiceEvalAdapter` | Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L553) |
| `createDurableRunCanaryApiClient` | Create durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L258) |
| `createDurableRunCanaryRunner` | Create durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L538) |
| `createDurableRunTokenGrowthCanaryCase` | Create a two-turn durable run canary for historical tool-input token growth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L38) |
| `createFailedEvalResult` | Result returned from create failed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L80) |
| `createLiveEvalApiClient` | Create live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L267) |
| `createLiveEvalCaseSupport` | Create live eval case support. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L494) |
| `createLiveEvalConversation` | Create live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L283) |
| `createLiveEvalProjectUploadFixture` | Create live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L335) |
| `createLiveEvalRelease` | Create live eval release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L430) |
| `createPassedEvalResult` | Result returned from create passed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L98) |
| `createPlainTextPdf` | Create plain text pdf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L12) |
| `createSkippedEvalResult` | Result returned from create skipped eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L62) |
| `deleteLiveEvalConversation` | Delete live eval conversation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L312) |
| `deleteLiveEvalProjectFile` | Delete live eval project file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L465) |
| `evaluateAgentServiceEvalEnvironment` | Evaluate whether the required live agent-service eval environment is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L502) |
| `evaluateRuntimeConfidenceEnv` | Evaluate runtime confidence env helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L14) |
| `findAssistantMessage` | Message shape for find assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L43) |
| `getLiveEvalProjectFile` | Return live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L396) |
| `hasEveryLiveEvalTag` | Check whether every live eval tag is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L27) |
| `hasFinished` | Check whether finished is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L479) |
| `listOpenLiveEvalInputRequests` | List open live eval input requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L491) |
| `parseDurableRunCanaryRunSummary` | Parses durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L112) |
| `printRuntimeConfidencePreflight` | Print runtime confidence preflight helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L40) |
| `resolveAgentServiceEvalEnvironment` | Resolve environment values for live agent-service eval execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L477) |
| `resolveDurableRunCanaryEnvironment` | Resolves durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L19) |
| `resolveLiveEvalEnvironment` | Resolves live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L20) |
| `resolveLiveEvalRequestedCaseIds` | Resolves live eval requested case IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L88) |
| `runDurableRunCanaryCli` | Run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L46) |
| `runLiveEvalCli` | Run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L86) |
| `selectLiveEvalCases` | Select live eval cases helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L61) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L58) |
| `submitLiveEvalInputResponse` | Response payload for submit live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L545) |
| `waitForOpenLiveEvalInputRequest` | Request payload for wait for open live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L517) |
| `withLiveEvalMetadata` | Applies live eval metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L161) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceEvalAdapterConfig` | Configuration for the live agent-service eval adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L94) |
| `AgentServiceEvalEnvironment` | Resolved environment values for live agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L28) |
| `AgentServiceEvalEnvironmentInput` | Environment input accepted by agent-service eval helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L25) |
| `AgentServiceEvalEnvironmentPreflightResult` | Preflight result for a live agent-service eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L39) |
| `AgentServiceEvalForwardedProps` | Veryfront forwarded props included in an AG-UI eval request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L46) |
| `AgentServiceEvalRequestBody` | AG-UI request body sent to an agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L74) |
| `BuildAgentServiceEvalRequestBodyInput` | Input accepted by `buildAgentServiceEvalRequestBody`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L59) |
| `BuildLiveEvalCaseMetadataInput` | Input payload for build live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L23) |
| `BuildLiveEvalRequestBodyInput` | Input payload for build live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L19) |
| `DurableRunCanaryApiClient` | Public API contract for durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L247) |
| `DurableRunCanaryApiConfig` | Configuration used by durable run canary API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L8) |
| `DurableRunCanaryCase` | Public API contract for durable run canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L370) |
| `DurableRunCanaryCliCaseFactoryInput` | Input payload for durable run canary cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L16) |
| `DurableRunCanaryCreateRootRunInput` | Input payload for durable run canary create root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L19) |
| `DurableRunCanaryEnvironment` | Public API contract for durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L7) |
| `DurableRunCanaryMessage` | Message shape for durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L48) |
| `DurableRunCanaryPreparedCase` | Public API contract for durable run canary prepared case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L355) |
| `DurableRunCanaryResult` | Result returned from durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L343) |
| `DurableRunCanaryRunnerConfig` | Configuration used by durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L377) |
| `DurableRunCanaryRunSummary` | Public API contract for durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L53) |
| `DurableRunCanarySendUserMessageInput` | Input payload for durable run canary send user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L25) |
| `DurableRunCanaryStartRunInput` | Input payload for durable run canary start run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L31) |
| `DurableRunTokenGrowthCanaryCaseInput` | Input payload for create durable run token-growth canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts#L13) |
| `LiveEvalApiClient` | Public API contract for live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L121) |
| `LiveEvalApiContext` | Context for live eval API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L9) |
| `LiveEvalCase` | Public API contract for live eval case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L37) |
| `LiveEvalCaseMetadata` | Public API contract for live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L4) |
| `LiveEvalCaseMetadataOptions` | Options accepted by live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L16) |
| `LiveEvalCaseSelectionInput` | Input payload for live eval case selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L15) |
| `LiveEvalCaseSurface` | Public API contract for live eval case surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L5) |
| `LiveEvalCaseTagRule` | Public API contract for live eval case tag rule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L8) |
| `LiveEvalCliCaseFactoryInput` | Input payload for live eval cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L34) |
| `LiveEvalCliCaseGroups` | Public API contract for live eval cli case groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L27) |
| `LiveEvalContext` | Context for live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L30) |
| `LiveEvalConversationInput` | Input payload for live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L27) |
| `LiveEvalCreateConversationInput` | Input payload for live eval create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L22) |
| `LiveEvalCreateReleaseInput` | Input payload for live eval create release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L47) |
| `LiveEvalEnvironment` | Public API contract for live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L7) |
| `LiveEvalInputRequestInput` | Input payload for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L71) |
| `LiveEvalInputRequestRecord` | Record shape for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L116) |
| `LiveEvalInputResponseValues` | Public API contract for live eval input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L59) |
| `LiveEvalProjectFile` | Public API contract for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L61) |
| `LiveEvalProjectFileInput` | Input payload for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L42) |
| `LiveEvalProjectFileReaderInput` | Input payload for live eval project file reader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L67) |
| `LiveEvalProjectUploadFixtureInput` | Input payload for live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L32) |
| `LiveEvalRequestBody` | Public API contract for live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L2) |
| `LiveEvalRequestTimeoutInput` | Input payload for live eval request timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L17) |
| `LiveEvalResultForPerformance` | Public API contract for live eval result for performance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L5) |
| `LiveEvalResultForReport` | Public API contract for live eval result for report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L9) |
| `LiveEvalResultRecord` | Record shape for live eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L4) |
| `LiveEvalRunnerConfig` | Configuration used by live eval runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L73) |
| `LiveEvalRuntime` | Public API contract for live eval runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L2) |
| `LiveEvalSubmitInputResponseInput` | Input payload for live eval submit input response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L64) |
| `LiveEvalWaitForOpenInputRequestInput` | Input payload for live eval wait for open input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L52) |
| `PreparedLiveEvalInput` | Input payload for prepared live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L21) |
| `RunDurableRunCanaryCliInput` | Input payload for run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L22) |
| `RunLiveEvalCliInput` | Input payload for run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L51) |
| `RuntimeConfidencePreflightResult` | Result returned from runtime confidence preflight. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L7) |
| `RuntimePerformanceSummary` | Public API contract for runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L11) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `durableRunCanaryRunnerInternals` | White-box helpers used by durable run canary tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L671) |
| `getDurableRunCanaryMessageSchema` | Zod schema for get durable run canary message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L38) |
| `liveEvalRunnerInternals` | White-box helpers used by live eval runner tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L637) |
