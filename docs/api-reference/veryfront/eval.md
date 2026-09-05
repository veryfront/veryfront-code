---
title: "veryfront/eval"
description: "First-class eval primitives for agent, tool, and stored dataset quality checks."
order: 8
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

### Target-free dataset eval

```ts
import { datasets, evalDataset, judges, metrics, runEval } from "veryfront/eval";

const supportReplyQuality = evalDataset({
  id: "eval:support-reply-quality",
  dataset: datasets.inline([
    {
      id: "billing-refund-reply",
      input: "Hello, I checked the duplicate charge and started a refund.",
    },
  ]),
  metrics: [
    metrics.judge.rubric({
      rubric: "The text must be polite, specific, and free of internal jargon.",
      judge: judges.llm.rubric({ framing: "text" }),
    }),
  ],
});

// No target runs: each example's stored value is graded directly. Metrics still
// execute, so an LLM judge like the one above calls a model provider.
const report = await runEval(supportReplyQuality, { adapters: {} });
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

| Name                         | Description                                                                         | Source                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `EVAL_REPORT_SCHEMA_VERSION` | Additive eval report contract version written by new reports and summary artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts) |

### Functions

| Name                                | Description                                                                                                | Source                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `compareEvalModelReports`           | Compare eval reports from multiple models using conservative promotion rules.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts) |
| `compareEvalReports`                | Compare a current eval report against a saved baseline report.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/baseline.ts)         |
| `createEvalDatasetMetadata`         | Create stable dataset metadata for report consumers and CI artifacts.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts)           |
| `createEvalModelComparisonMarkdown` | Render a human-reviewable markdown summary for a model comparison report.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/model-comparison.ts) |
| `createEvalReport`                  | Create a JSON-serializable eval report from executed records.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts)           |
| `createEvalRunId`                   | Create a timestamp-sortable eval run id with a collision-resistant suffix.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/run-id.ts)           |
| `createEvalRunProvenance`           | Build stable provenance metadata from explicit git/cloud inputs.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts)       |
| `createEvalSourceDocument`          | Create the normalized Eval document Studio can list, inspect, and edit.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)           |
| `deriveEvalId`                      | Derive the stable `eval:<path>` ID for an eval file.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts)        |
| `discoverEvals`                     | Discover eval definitions from a project eval directory.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts)        |
| `evalAgent`                         | Define an eval that targets a Veryfront agent.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts)          |
| `evalDataset`                       | Define a target-free eval that grades each stored dataset example directly.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts)          |
| `evalTool`                          | Define an eval that targets a Veryfront tool.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts)          |
| `exportEvalReport`                  | Export an eval report through the configured eval report exporter registry.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts)           |
| `findEvalById`                      | Discover and return one eval definition by ID.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts)        |
| `isEvalDefinition`                  | Check whether a value is a normalized eval definition.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts)          |
| `resolveEvalRunProvenance`          | Resolve local or Cloud provenance for an eval run without failing the eval if git metadata is unavailable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/provenance.ts)       |
| `runEval`                           | Execute an eval locally with injected target adapters.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts)           |
| `summarizeEvalRecords`              | Summarize eval records into pass/fail and metric aggregates.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts)           |

### Types

| Name                                  | Description                                                                                                                                                        | Source                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `CreateEvalSourceDocumentOptions`     | Options for creating a Studio source document from a discovered eval.                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `DiscoveredEval`                      | Eval definition discovered from project source.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts) |
| `EvalAgentAdapter`                    | Adapter used by `runEval` to execute V1 agent targets.                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalAgentAdapterContext`             | Context passed to an agent adapter when `runEval` executes an example.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalAgentAdapterResult`              | Agent adapter result normalized into an eval record.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalAgentInput`                      | Input accepted by `evalAgent`.                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalAnswerGroundednessMetricOptions` | Options for judge-backed answer grounding checks.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalBudgetDeltaSummary`              | Numeric budget delta between a current eval report and a baseline report.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalCheckContext`                    | Context passed to an eval definition's `check` callback.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalCitation`                        | Citation emitted by an answer and matched against retrieved or expected sources.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalDataset`                         | Dataset loader used by an eval definition.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalDatasetInput`                    | Input accepted by `evalDataset`. Dataset evals grade each stored example value directly, so they have no execution target; the report identity is the stable `id`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalDatasetLoadContext`              | Context passed to dataset loaders.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalDefinition`                      | First-class eval definition discovered from project source.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalDiscoveryOptions`                | Options for project-local eval discovery.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts) |
| `EvalDiscoveryResult`                 | Result returned by eval discovery.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts) |
| `EvalDurationSummary`                 | Duration aggregate for an eval report.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalEditableField`                   | Form-editable Eval source field name.                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `EvalExample`                         | Normalized dataset example used by eval runners and reports.                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalExampleInput`                    | Dataset example shape accepted by eval definitions.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalExpect`                          | Built-in expectation helpers available inside `check`.                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalExpectation`                     | Fluent severity helpers for `check` expectations.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalFailedExampleSummary`            | Per-example failure aggregate included in a report summary.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalFlakeSummary`                    | Flake classification for repeated eval examples.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalGateFailureSummary`              | Blocking failure included in a report summary.                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalKnowledgeCitationMetricOptions`  | Options for citation precision and recall over retrieved knowledge.                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalKnowledgeExpectedSource`         | Expected knowledge source or passage for retrieval-quality metrics.                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalKnowledgeMrrMetricOptions`       | Options for mean reciprocal rank over retrieved knowledge.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalKnowledgeRetrievalMetricOptions` | Options shared by knowledge retrieval metrics.                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalLlmGroundednessJudgeOptions`     | Options for the built-in LLM groundedness judge.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts)    |
| `EvalLlmRubricJudgeOptions`           | Options for the built-in general-purpose LLM rubric judge.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts)    |
| `EvalMetric`                          | Metric contract used by eval definitions.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMetricContext`                   | Optional runtime context passed to metric evaluators.                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMetricDeltaSummary`              | Per-metric delta between a current eval report and a baseline report.                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMetricFamily`                    | Metric family used for grouping report summaries.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMetricResult`                    | Result emitted by a metric or check assertion.                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMetricSummary`                   | Aggregate pass/fail summary for one metric.                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMetricThreshold`                 | Numeric threshold attached to score-based metrics.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMockTools`                       | Static or request-scoped mock tools for local `evalAgent` execution.                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMockToolsResolver`               | Request-scoped mock tool resolver for local `evalAgent` execution.                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalMockToolsResolverContext`        | Context passed to an agent eval mock tool resolver.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelCandidateComparison`        | Candidate-vs-baseline comparison used to decide whether a model is promotable.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelComparison`                 | Aggregate report for comparing one baseline model against candidate models.                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelComparisonConstraint`       | Hard model comparison eligibility constraint.                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelComparisonDecision`         | Conservative model comparison recommendation.                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelComparisonMetricName`       | Metric names available to model comparison constraints and objectives.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelComparisonObjective`        | Weighted model comparison objective used to rank eligible candidates.                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelComparisonOptions`          | Promotion thresholds for model comparison.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalModelReportSummary`              | Per-model row in an eval model comparison report.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalRecord`                          | One executed example and repetition inside an eval report.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReport`                          | JSON-serializable report produced by `runEval`.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReportComparison`                | Baseline comparison for a current eval report.                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReportComparisonPolicy`          | Regression policy for comparing a current eval report to a saved baseline.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReportDatasetMetadata`           | Stable dataset identity attached to new eval reports when examples are available.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReportExportConfig`              | Export configuration for a completed eval report.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReportMetadata`                  | Additional report metadata that should not affect pass/fail semantics.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalReportSummary`                   | Aggregate pass/fail summary for one eval report.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalRetrievedContext`                | Retrieved context item captured for deterministic RAG metrics.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalRun`                             | V2-ready Eval run projection.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `EvalRunProvenance`                   | Runtime and source identity attached to an eval report.                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalSeverity`                        | How a metric result affects the final eval result.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalSource`                          | Source location for a discovered eval definition.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalSourceDocument`                  | Studio-editable Eval source document.                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `EvalSourcePatch`                     | Eval source patch submitted by Studio forms.                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `EvalSourceReference`                 | Source location for an Eval definition.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `EvalStudioCapability`                | Capability string Studio uses for Eval source and run actions.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)    |
| `EvalTargetKind`                      | Primitive kind an eval can execute.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolAdapter`                     | Adapter used by `runEval` to execute tool targets.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolAdapterContext`              | Context passed to a tool adapter when `runEval` executes an example.                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolAdapterResult`               | Tool adapter result normalized into an eval record.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolCall`                        | Tool call metadata captured during one eval record.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolCallCountOptions`            | Options for checking how often a tool was called.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolCallMatchOptions`            | Options for matching a required tool call.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolCallStatus`                  | Normalized status for a tool call captured during an eval record.                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolInput`                       | Input accepted by `evalTool`.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalToolInputMatchMode`              | How expected tool input is compared to the captured tool input.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalTrace`                           | Trace metadata captured for one eval record.                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalUsage`                           | Token and cost usage captured for one eval record.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `EvalUsageSummary`                    | Usage totals for an eval report.                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `LocalEvalReport`                     | Eval report returned by local execution, with its dataset hash intact.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |
| `RunEvalOptions`                      | Options for running an eval locally.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)     |

### Constants

| Name                            | Description                                                                         | Source                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `datasets`                      | Dataset factories for inline, JSON, and JSONL eval examples.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/datasets.ts) |
| `getEvalEditableFieldSchema`    | Schema for an editable Eval source field name.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `getEvalRunSchema`              | Schema for V2-ready Eval run projections.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `getEvalSourceDocumentSchema`   | Schema for a Studio-editable Eval source document.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `getEvalSourcePatchSchema`      | Schema for a source patch submitted from an Eval editor.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `getEvalSourceReferenceSchema`  | Schema for an Eval source reference.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `getEvalStudioCapabilitySchema` | Schema for Eval Studio capabilities.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `getEvalTargetKindSchema`       | Schema for an Eval target primitive kind.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts)   |
| `judges`                        | Built-in judge factories for semantic eval metrics.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/judges.ts)   |
| `metrics`                       | Metric factories for deterministic answers, agent behavior, operations, and judges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/metrics.ts)  |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/eval/agent-service`

```ts
import {
  assertCompleted,
  assertNoMalformedCreateFileToolCalls,
  buildAgentServiceEvalRequestBody,
} from "veryfront/eval/agent-service";
```

#### Components

| Name                                             | Description                                                | Source                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT`            | Default local AG-UI endpoint used by agent-service evals.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS`          | Default value for durable run canary timeout ms.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts)  |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES`               | Default value for live eval area tag rules.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `DEFAULT_LIVE_EVAL_ENDPOINT`                     | Default value for live eval endpoint.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts)            |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` | Default value for live eval optional judge case prefixes.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `DURABLE_RUN_TOKEN_GROWTH_CANARY_MARKER`         | Marker used by the durable run token-growth canary prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts) |

#### Functions

| Name                                    | Description                                                                                  | Source                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `assertCompleted`                       | Assert that a durable run canary completed successfully.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts)   |
| `assertNoMalformedCreateFileToolCalls`  | Assert no malformed create file tool calls helper.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts)   |
| `buildAgentServiceEvalRequestBody`      | Build the AG-UI request body for a single eval example.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `buildFailureSuffix`                    | Builds failure suffix.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts)             |
| `buildLiveEvalCaseMetadata`             | Builds live eval case metadata.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `buildLiveEvalCaseTagSummary`           | Builds live eval case tag summary.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `buildLiveEvalRequestBody`              | Builds live eval request body.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts)                |
| `buildLiveEvalRuntimeSummary`           | Builds live eval runtime summary.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `buildLiveEvalStatusSummary`            | Builds live eval status summary.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `buildProgressLine`                     | Builds progress line.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts)             |
| `buildRuntimePerformanceSummary`        | Builds runtime performance summary.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts)            |
| `cancelLiveEvalInputRequest`            | Request payload for cancel live eval input.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `collectAssistantText`                  | Collect assistant text helper.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts)   |
| `containsOrderedSubsequence`            | Contains ordered subsequence helper.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts)             |
| `containsSkillLoad`                     | Contains skill load helper.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `countStepStartedEvents`                | Count step started events helper.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `createAgentServiceEvalAdapter`         | Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `createDurableRunCanaryApiClient`       | Create durable run canary API client.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `createDurableRunCanaryRunner`          | Create durable run canary runner.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `createDurableRunTokenGrowthCanaryCase` | Create a two-turn durable run canary for historical tool-input token growth.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts) |
| `createFailedEvalResult`                | Result returned from create failed eval.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts)                 |
| `createLiveEvalApiClient`               | Create live eval API client.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `createLiveEvalCaseSupport`             | Create live eval case support.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `createLiveEvalConversation`            | Create live eval conversation.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `createLiveEvalProjectUploadFixture`    | Create live eval project upload fixture.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `createLiveEvalRelease`                 | Create live eval release.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `createPassedEvalResult`                | Result returned from create passed eval.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts)                 |
| `createPlainTextPdf`                    | Create plain text pdf.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts)             |
| `createSkippedEvalResult`               | Result returned from create skipped eval.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts)                 |
| `deleteLiveEvalConversation`            | Delete live eval conversation helper.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `deleteLiveEvalProjectFile`             | Delete live eval project file helper.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `evaluateAgentServiceEvalEnvironment`   | Evaluate whether the required live agent-service eval environment is present.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `evaluateRuntimeConfidenceEnv`          | Evaluate runtime confidence env helper.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts)              |
| `findAssistantMessage`                  | Message shape for find assistant.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts)   |
| `getLiveEvalProjectFile`                | Return live eval project file.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `hasEveryLiveEvalTag`                   | Check whether every live eval tag is present.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `hasFinished`                           | Check whether finished is present.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `listOpenLiveEvalInputRequests`         | List open live eval input requests.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `parseDurableRunCanaryRunSummary`       | Parses durable run canary run summary.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `printRuntimeConfidencePreflight`       | Print runtime confidence preflight helper.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts)              |
| `resolveAgentServiceEvalEnvironment`    | Resolve environment values for live agent-service eval execution.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `resolveDurableRunCanaryEnvironment`    | Resolves durable run canary environment.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts)  |
| `resolveLiveEvalEnvironment`            | Resolves live eval environment.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts)            |
| `resolveLiveEvalRequestedCaseIds`       | Resolves live eval requested case IDs.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `runDurableRunCanaryCli`                | Run durable run canary cli.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts)   |
| `runLiveEvalCli`                        | Run live eval cli.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts)             |
| `selectLiveEvalCases`                   | Select live eval cases helper.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `stringifyUnknown`                      | Stringify unknown helper.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts)   |
| `submitLiveEvalInputResponse`           | Response payload for submit live eval input.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `waitForOpenLiveEvalInputRequest`       | Request payload for wait for open live eval input.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `withLiveEvalMetadata`                  | Applies live eval metadata.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |

#### Types

| Name                                         | Description                                                     | Source                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AgentServiceEvalAdapterConfig`              | Configuration for the live agent-service eval adapter.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `AgentServiceEvalEnvironment`                | Resolved environment values for live agent-service evals.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `AgentServiceEvalEnvironmentInput`           | Environment input accepted by agent-service eval helpers.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `AgentServiceEvalEnvironmentPreflightResult` | Preflight result for a live agent-service eval environment.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `AgentServiceEvalForwardedProps`             | Veryfront forwarded props included in an AG-UI eval request.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `AgentServiceEvalRequestBody`                | AG-UI request body sent to an agent-service endpoint.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `BuildAgentServiceEvalRequestBodyInput`      | Input accepted by `buildAgentServiceEvalRequestBody`.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts)                                   |
| `BuildLiveEvalCaseMetadataInput`             | Input payload for build live eval case metadata.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `BuildLiveEvalRequestBodyInput`              | Input payload for build live eval request body.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts)                |
| `DurableRunCanaryApiClient`                  | Public API contract for durable run canary API client.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryApiConfig`                  | Configuration used by durable run canary API.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryCase`                       | Public API contract for durable run canary case.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryCliCaseFactoryInput`        | Input payload for durable run canary cli case factory.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts)   |
| `DurableRunCanaryCreateRootRunInput`         | Input payload for durable run canary create root run.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryEnvironment`                | Public API contract for durable run canary environment.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts)  |
| `DurableRunCanaryExecution`                  | Execution metadata retained for each durable run canary prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryMessage`                    | Message shape for durable run canary.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryPreparedCase`               | Public API contract for durable run canary prepared case.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryResult`                     | Result returned from durable run canary.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryRunnerConfig`               | Configuration used by durable run canary runner.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryRunSummary`                 | Public API contract for durable run canary run summary.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanarySendUserMessageInput`       | Input payload for durable run canary send user message.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunCanaryStartRunInput`              | Input payload for durable run canary start run.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts)       |
| `DurableRunTokenGrowthCanaryCaseInput`       | Input payload for create durable run token-growth canary case.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/token-growth.ts) |
| `LiveEvalApiClient`                          | Public API contract for live eval API client.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalApiContext`                         | Context for live eval API.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalCase`                               | Public API contract for live eval case.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `LiveEvalCaseMetadata`                       | Public API contract for live eval case metadata.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `LiveEvalCaseMetadataOptions`                | Options accepted by live eval case metadata.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `LiveEvalCaseSelectionInput`                 | Input payload for live eval case selection.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `LiveEvalCaseSurface`                        | Public API contract for live eval case surface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `LiveEvalCaseTagRule`                        | Public API contract for live eval case tag rule.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts)               |
| `LiveEvalCliCaseFactoryInput`                | Input payload for live eval cli case factory.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts)             |
| `LiveEvalCliCaseGroups`                      | Public API contract for live eval cli case groups.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts)             |
| `LiveEvalContext`                            | Context for live eval.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `LiveEvalConversationInput`                  | Input payload for live eval conversation.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalCreateConversationInput`            | Input payload for live eval create conversation.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalCreateReleaseInput`                 | Input payload for live eval create release.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalEnvironment`                        | Public API contract for live eval environment.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts)            |
| `LiveEvalInputRequestInput`                  | Input payload for live eval input request.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalInputRequestRecord`                 | Record shape for live eval input request.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalInputResponseValues`                | Public API contract for live eval input response values.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalProjectFile`                        | Public API contract for live eval project file.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `LiveEvalProjectFileInput`                   | Input payload for live eval project file.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalProjectFileReaderInput`             | Input payload for live eval project file reader.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `LiveEvalProjectUploadFixtureInput`          | Input payload for live eval project upload fixture.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalRequestBody`                        | Public API contract for live eval request body.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts)                |
| `LiveEvalRequestTimeoutInput`                | Input payload for live eval request timeout.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalResultForPerformance`               | Public API contract for live eval result for performance.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts)            |
| `LiveEvalResultForReport`                    | Public API contract for live eval result for report.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts)                 |
| `LiveEvalResultRecord`                       | Record shape for live eval result.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts)                 |
| `LiveEvalRunnerConfig`                       | Configuration used by live eval runner.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `LiveEvalRuntime`                            | Public API contract for live eval runtime.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts)            |
| `LiveEvalSubmitInputResponseInput`           | Input payload for live eval submit input response.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `LiveEvalWaitForOpenInputRequestInput`       | Input payload for live eval wait for open input request.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts)             |
| `PreparedLiveEvalInput`                      | Input payload for prepared live eval.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts)                 |
| `RunDurableRunCanaryCliInput`                | Input payload for run durable run canary cli.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts)   |
| `RunLiveEvalCliInput`                        | Input payload for run live eval cli.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts)             |
| `RuntimeConfidencePreflightResult`           | Result returned from runtime confidence preflight.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts)              |
| `RuntimePerformanceSummary`                  | Public API contract for runtime performance summary.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts)            |

#### Constants

| Name                               | Description                                    | Source                                                                                                                |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `getDurableRunCanaryMessageSchema` | Zod schema for get durable run canary message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts) |
