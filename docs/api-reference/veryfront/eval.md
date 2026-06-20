---
title: "veryfront/eval"
description: "First-class eval primitives for agent quality checks."
order: 7
---

## Import

```ts
import {
  createEvalReport,
  createEvalSourceDocument,
  deriveEvalId,
  discoverEvals,
  evalAgent,
  findEvalById,
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
    metrics.agent.noFailedTools().gate(),
  ],
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createEvalReport` | Create a JSON-serializable eval report from executed records. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L66) |
| `createEvalSourceDocument` | Create the normalized Eval document Studio can list, inspect, and edit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L210) |
| `deriveEvalId` | Derive the stable `eval:<path>` ID for an eval file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L69) |
| `discoverEvals` | Discover eval definitions from a project eval directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L143) |
| `evalAgent` | Define a V1 eval that targets a Veryfront agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L26) |
| `findEvalById` | Discover and return one eval definition by ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L184) |
| `isEvalDefinition` | Check whether a value is a normalized eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L48) |
| `runEval` | Execute an eval locally with injected target adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L109) |
| `summarizeEvalRecords` | Summarize eval records into pass/fail and metric aggregates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L53) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateEvalSourceDocumentOptions` | Options for creating a Studio source document from a discovered eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L152) |
| `DiscoveredEval` | Eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L22) |
| `EvalAgentAdapter` | Adapter used by `runEval` to execute V1 agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L205) |
| `EvalAgentAdapterContext` | Context passed to an agent adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L186) |
| `EvalAgentAdapterResult` | Agent adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L193) |
| `EvalAgentInput` | Input accepted by `evalAgent`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L172) |
| `EvalCheckContext` | Context passed to an eval definition's `check` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L140) |
| `EvalDataset` | Dataset loader used by an eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L46) |
| `EvalDatasetLoadContext` | Context passed to dataset loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L41) |
| `EvalDefinition` | First-class eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L155) |
| `EvalDiscoveryOptions` | Options for project-local eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L31) |
| `EvalDiscoveryResult` | Result returned by eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L39) |
| `EvalEditableField` | Form-editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L141) |
| `EvalExample` | Normalized dataset example used by eval runners and reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L25) |
| `EvalExampleInput` | Dataset example shape accepted by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L33) |
| `EvalExpect` | Built-in expectation helpers available inside `check`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L133) |
| `EvalExpectation` | Fluent severity helpers for `check` expectations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L126) |
| `EvalMetric` | Metric contract used by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L113) |
| `EvalMetricContext` | Optional runtime context passed to metric evaluators. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L108) |
| `EvalMetricFamily` | Metric family used for grouping report summaries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L13) |
| `EvalMetricResult` | Result emitted by a metric or check assertion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L95) |
| `EvalMetricSummary` | Aggregate pass/fail summary for one metric. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L220) |
| `EvalMetricThreshold` | Numeric threshold attached to score-based metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L16) |
| `EvalRecord` | One executed example and repetition inside an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L76) |
| `EvalReport` | JSON-serializable report produced by `runEval`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L240) |
| `EvalReportSummary` | Aggregate pass/fail summary for one eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L231) |
| `EvalRun` | V2-ready Eval run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L149) |
| `EvalSeverity` | How a metric result affects the final eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L10) |
| `EvalSource` | Source location for a discovered eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L149) |
| `EvalSourceDocument` | Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L145) |
| `EvalSourcePatch` | Eval source patch submitted by Studio forms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L147) |
| `EvalSourceReference` | Source location for an Eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L143) |
| `EvalStudioCapability` | Capability string Studio uses for Eval read and write access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L139) |
| `EvalTargetKind` | Primitive kind an eval can execute. V1 supports agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L7) |
| `EvalToolCall` | Tool call metadata captured during one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L62) |
| `EvalTrace` | Trace metadata captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L70) |
| `EvalUsage` | Token and cost usage captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L54) |
| `RunEvalOptions` | Options for running an eval locally. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L210) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `datasets` | Dataset factories for inline, JSON, and JSONL eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/datasets.ts#L40) |
| `getEvalEditableFieldSchema` | Schema for an editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L11) |
| `getEvalRunSchema` | Schema for V2-ready Eval run projections. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L114) |
| `getEvalSourceDocumentSchema` | Schema for a Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L74) |
| `getEvalSourcePatchSchema` | Schema for a source patch submitted from an Eval editor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L95) |
| `getEvalSourceReferenceSchema` | Schema for an Eval source reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L28) |
| `getEvalStudioCapabilitySchema` | Schema for Eval Studio capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L6) |
| `metrics` | Metric factories for deterministic answers, agent behavior, operations, and judges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/metrics.ts#L133) |
