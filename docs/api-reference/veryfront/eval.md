---
title: "veryfront/eval"
description: "First-class eval primitives for agent quality checks."
order: 7
---

## Import

```ts
import {
  compareEvalReports,
  createEvalReport,
  createEvalSourceDocument,
  deriveEvalId,
  discoverEvals,
  evalAgent,
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
| `compareEvalReports` | Compare a current eval report against a saved baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/baseline.ts#L87) |
| `createEvalReport` | Create a JSON-serializable eval report from executed records. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L218) |
| `createEvalSourceDocument` | Create the normalized Eval document Studio can list, inspect, and edit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L289) |
| `deriveEvalId` | Derive the stable `eval:<path>` ID for an eval file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L77) |
| `discoverEvals` | Discover eval definitions from a project eval directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L152) |
| `evalAgent` | Define a V1 eval that targets a Veryfront agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L26) |
| `findEvalById` | Discover and return one eval definition by ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L195) |
| `isEvalDefinition` | Check whether a value is a normalized eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/factory.ts#L48) |
| `runEval` | Execute an eval locally with injected target adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/runner.ts#L213) |
| `summarizeEvalRecords` | Summarize eval records into pass/fail and metric aggregates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/report.ts#L195) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateEvalSourceDocumentOptions` | Options for creating a Studio source document from a discovered eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L230) |
| `DiscoveredEval` | Eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L22) |
| `EvalAgentAdapter` | Adapter used by `runEval` to execute V1 agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L211) |
| `EvalAgentAdapterContext` | Context passed to an agent adapter when `runEval` executes an example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L192) |
| `EvalAgentAdapterResult` | Agent adapter result normalized into an eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L199) |
| `EvalAgentInput` | Input accepted by `evalAgent`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L178) |
| `EvalCheckContext` | Context passed to an eval definition's `check` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L146) |
| `EvalDataset` | Dataset loader used by an eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L52) |
| `EvalDatasetLoadContext` | Context passed to dataset loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L47) |
| `EvalDefinition` | First-class eval definition discovered from project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L161) |
| `EvalDiscoveryOptions` | Options for project-local eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L37) |
| `EvalDiscoveryResult` | Result returned by eval discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/discovery.ts#L47) |
| `EvalDurationSummary` | Duration aggregate for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L245) |
| `EvalEditableField` | Form-editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L219) |
| `EvalExample` | Normalized dataset example used by eval runners and reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L31) |
| `EvalExampleInput` | Dataset example shape accepted by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L39) |
| `EvalExpect` | Built-in expectation helpers available inside `check`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L139) |
| `EvalExpectation` | Fluent severity helpers for `check` expectations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L132) |
| `EvalFailedExampleSummary` | Per-example failure aggregate included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L275) |
| `EvalFlakeSummary` | Flake classification for repeated eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L285) |
| `EvalGateFailureSummary` | Blocking failure included in a report summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L263) |
| `EvalMetric` | Metric contract used by eval definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L119) |
| `EvalMetricContext` | Optional runtime context passed to metric evaluators. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L114) |
| `EvalMetricDeltaSummary` | Per-metric delta between a current eval report and a baseline report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L293) |
| `EvalMetricFamily` | Metric family used for grouping report summaries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L19) |
| `EvalMetricResult` | Result emitted by a metric or check assertion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L101) |
| `EvalMetricSummary` | Aggregate pass/fail summary for one metric. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L234) |
| `EvalMetricThreshold` | Numeric threshold attached to score-based metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L22) |
| `EvalRecord` | One executed example and repetition inside an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L82) |
| `EvalReport` | JSON-serializable report produced by `runEval`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L342) |
| `EvalReportComparison` | Baseline comparison for a current eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L307) |
| `EvalReportExportConfig` | Export configuration for a completed eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L227) |
| `EvalReportSummary` | Aggregate pass/fail summary for one eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L321) |
| `EvalRun` | V2-ready Eval run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L227) |
| `EvalSeverity` | How a metric result affects the final eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L16) |
| `EvalSource` | Source location for a discovered eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L155) |
| `EvalSourceDocument` | Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L223) |
| `EvalSourcePatch` | Eval source patch submitted by Studio forms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L225) |
| `EvalSourceReference` | Source location for an Eval definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L221) |
| `EvalStudioCapability` | Capability string Studio uses for Eval source and run actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L217) |
| `EvalTargetKind` | Primitive kind an eval can execute. V1 supports agent targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L13) |
| `EvalToolCall` | Tool call metadata captured during one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L68) |
| `EvalTrace` | Trace metadata captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L76) |
| `EvalUsage` | Token and cost usage captured for one eval record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L60) |
| `EvalUsageSummary` | Usage totals for an eval report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L255) |
| `RunEvalOptions` | Options for running an eval locally. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L216) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `datasets` | Dataset factories for inline, JSON, and JSONL eval examples. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/datasets.ts#L40) |
| `getEvalEditableFieldSchema` | Schema for an editable Eval source field name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L11) |
| `getEvalRunSchema` | Schema for V2-ready Eval run projections. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L185) |
| `getEvalSourceDocumentSchema` | Schema for a Studio-editable Eval source document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L145) |
| `getEvalSourcePatchSchema` | Schema for a source patch submitted from an Eval editor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L166) |
| `getEvalSourceReferenceSchema` | Schema for an Eval source reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L28) |
| `getEvalStudioCapabilitySchema` | Schema for Eval Studio capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/studio.ts#L6) |
| `metrics` | Metric factories for deterministic answers, agent behavior, operations, and judges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/metrics.ts#L133) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/eval/agent-service`

```ts
import { assertCompleted, assertNoMalformedCreateFileToolCalls, buildAgentServiceEvalRequestBody } from "veryfront/eval/agent-service";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT` | Default local AG-UI endpoint used by agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L19) |
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` | Default value for durable run canary timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L15) |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` | Default value for live eval area tag rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L36) |
| `DEFAULT_LIVE_EVAL_ENDPOINT` | Default value for live eval endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L16) |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` | Default value for live eval optional judge case prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L29) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCompleted` | Assert that a durable run canary completed successfully. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L31) |
| `assertNoMalformedCreateFileToolCalls` | Assert no malformed create file tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L78) |
| `buildAgentServiceEvalRequestBody` | Build the AG-UI request body for a single eval example. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L338) |
| `buildFailureSuffix` | Builds failure suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L79) |
| `buildLiveEvalCaseMetadata` | Builds live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L121) |
| `buildLiveEvalCaseTagSummary` | Builds live eval case tag summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L40) |
| `buildLiveEvalRequestBody` | Builds live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L32) |
| `buildLiveEvalRuntimeSummary` | Builds live eval runtime summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L136) |
| `buildLiveEvalStatusSummary` | Builds live eval status summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L151) |
| `buildProgressLine` | Builds progress line. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L58) |
| `buildRuntimePerformanceSummary` | Builds runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L36) |
| `cancelLiveEvalInputRequest` | Request payload for cancel live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L569) |
| `collectAssistantText` | Collect assistant text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L70) |
| `containsOrderedSubsequence` | Contains ordered subsequence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L92) |
| `containsSkillLoad` | Contains skill load helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L478) |
| `countStepStartedEvents` | Count step started events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L483) |
| `createAgentServiceEvalAdapter` | Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L368) |
| `createDurableRunCanaryApiClient` | Create durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L257) |
| `createDurableRunCanaryRunner` | Create durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L503) |
| `createFailedEvalResult` | Result returned from create failed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L79) |
| `createLiveEvalApiClient` | Create live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L266) |
| `createLiveEvalCaseSupport` | Create live eval case support. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L488) |
| `createLiveEvalConversation` | Create live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L282) |
| `createLiveEvalProjectUploadFixture` | Create live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L334) |
| `createLiveEvalRelease` | Create live eval release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L429) |
| `createPassedEvalResult` | Result returned from create passed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L97) |
| `createPlainTextPdf` | Create plain text pdf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/formatting.ts#L11) |
| `createSkippedEvalResult` | Result returned from create skipped eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L61) |
| `deleteLiveEvalConversation` | Delete live eval conversation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L311) |
| `deleteLiveEvalProjectFile` | Delete live eval project file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L464) |
| `evaluateAgentServiceEvalEnvironment` | Evaluate whether the required live agent-service eval environment is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L317) |
| `evaluateRuntimeConfidenceEnv` | Evaluate runtime confidence env helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L13) |
| `findAssistantMessage` | Message shape for find assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L42) |
| `getLiveEvalProjectFile` | Return live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L395) |
| `hasEveryLiveEvalTag` | Check whether every live eval tag is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L26) |
| `hasFinished` | Check whether finished is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L473) |
| `listOpenLiveEvalInputRequests` | List open live eval input requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L490) |
| `parseDurableRunCanaryRunSummary` | Parses durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L111) |
| `printRuntimeConfidencePreflight` | Print runtime confidence preflight helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L39) |
| `resolveAgentServiceEvalEnvironment` | Resolve environment values for live agent-service eval execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L292) |
| `resolveDurableRunCanaryEnvironment` | Resolves durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L18) |
| `resolveLiveEvalEnvironment` | Resolves live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L19) |
| `resolveLiveEvalRequestedCaseIds` | Resolves live eval requested case IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L87) |
| `runDurableRunCanaryCli` | Run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L45) |
| `runLiveEvalCli` | Run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L85) |
| `selectLiveEvalCases` | Select live eval cases helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L60) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/validation.ts#L57) |
| `submitLiveEvalInputResponse` | Response payload for submit live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L544) |
| `waitForOpenLiveEvalInputRequest` | Request payload for wait for open live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L516) |
| `withLiveEvalMetadata` | Applies live eval metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L160) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceEvalAdapterConfig` | Configuration for the live agent-service eval adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L91) |
| `AgentServiceEvalEnvironment` | Resolved environment values for live agent-service evals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L25) |
| `AgentServiceEvalEnvironmentInput` | Environment input accepted by agent-service eval helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L22) |
| `AgentServiceEvalEnvironmentPreflightResult` | Preflight result for a live agent-service eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L36) |
| `AgentServiceEvalForwardedProps` | Veryfront forwarded props included in an AG-UI eval request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L43) |
| `AgentServiceEvalRequestBody` | AG-UI request body sent to an agent-service endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L71) |
| `BuildAgentServiceEvalRequestBodyInput` | Input accepted by `buildAgentServiceEvalRequestBody`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service.ts#L56) |
| `BuildLiveEvalCaseMetadataInput` | Input payload for build live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L22) |
| `BuildLiveEvalRequestBodyInput` | Input payload for build live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L18) |
| `DurableRunCanaryApiClient` | Public API contract for durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L246) |
| `DurableRunCanaryApiConfig` | Configuration used by durable run canary API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L7) |
| `DurableRunCanaryCase` | Public API contract for durable run canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L368) |
| `DurableRunCanaryCliCaseFactoryInput` | Input payload for durable run canary cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L15) |
| `DurableRunCanaryCreateRootRunInput` | Input payload for durable run canary create root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L18) |
| `DurableRunCanaryEnvironment` | Public API contract for durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/environment.ts#L6) |
| `DurableRunCanaryMessage` | Message shape for durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L47) |
| `DurableRunCanaryPreparedCase` | Public API contract for durable run canary prepared case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L354) |
| `DurableRunCanaryResult` | Result returned from durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L342) |
| `DurableRunCanaryRunnerConfig` | Configuration used by durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L375) |
| `DurableRunCanaryRunSummary` | Public API contract for durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L52) |
| `DurableRunCanarySendUserMessageInput` | Input payload for durable run canary send user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L24) |
| `DurableRunCanaryStartRunInput` | Input payload for durable run canary start run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L30) |
| `LiveEvalApiClient` | Public API contract for live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L120) |
| `LiveEvalApiContext` | Context for live eval API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L8) |
| `LiveEvalCase` | Public API contract for live eval case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L36) |
| `LiveEvalCaseMetadata` | Public API contract for live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L3) |
| `LiveEvalCaseMetadataOptions` | Options accepted by live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L15) |
| `LiveEvalCaseSelectionInput` | Input payload for live eval case selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L14) |
| `LiveEvalCaseSurface` | Public API contract for live eval case surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L4) |
| `LiveEvalCaseTagRule` | Public API contract for live eval case tag rule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/metadata.ts#L7) |
| `LiveEvalCliCaseFactoryInput` | Input payload for live eval cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L33) |
| `LiveEvalCliCaseGroups` | Public API contract for live eval cli case groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L26) |
| `LiveEvalContext` | Context for live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L29) |
| `LiveEvalConversationInput` | Input payload for live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L26) |
| `LiveEvalCreateConversationInput` | Input payload for live eval create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L21) |
| `LiveEvalCreateReleaseInput` | Input payload for live eval create release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L46) |
| `LiveEvalEnvironment` | Public API contract for live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/environment.ts#L6) |
| `LiveEvalInputRequestInput` | Input payload for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L70) |
| `LiveEvalInputRequestRecord` | Record shape for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L115) |
| `LiveEvalInputResponseValues` | Public API contract for live eval input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L58) |
| `LiveEvalProjectFile` | Public API contract for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L60) |
| `LiveEvalProjectFileInput` | Input payload for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L41) |
| `LiveEvalProjectFileReaderInput` | Input payload for live eval project file reader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L66) |
| `LiveEvalProjectUploadFixtureInput` | Input payload for live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L31) |
| `LiveEvalRequestBody` | Public API contract for live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/request.ts#L1) |
| `LiveEvalRequestTimeoutInput` | Input payload for live eval request timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L16) |
| `LiveEvalResultForPerformance` | Public API contract for live eval result for performance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L4) |
| `LiveEvalResultForReport` | Public API contract for live eval result for report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/report.ts#L8) |
| `LiveEvalResultRecord` | Record shape for live eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/result.ts#L3) |
| `LiveEvalRunnerConfig` | Configuration used by live eval runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L72) |
| `LiveEvalRuntime` | Public API contract for live eval runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L1) |
| `LiveEvalSubmitInputResponseInput` | Input payload for live eval submit input response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L63) |
| `LiveEvalWaitForOpenInputRequestInput` | Input payload for live eval wait for open input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/api-client.ts#L51) |
| `PreparedLiveEvalInput` | Input payload for prepared live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L20) |
| `RunDurableRunCanaryCliInput` | Input payload for run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/cli-runner.ts#L21) |
| `RunLiveEvalCliInput` | Input payload for run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/cli-runner.ts#L50) |
| `RuntimeConfidencePreflightResult` | Result returned from runtime confidence preflight. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/preflight.ts#L6) |
| `RuntimePerformanceSummary` | Public API contract for runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/performance.ts#L10) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `durableRunCanaryRunnerInternals` | White-box helpers used by durable run canary tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L611) |
| `getDurableRunCanaryMessageSchema` | Zod schema for get durable run canary message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/durable-run-canaries/runner.ts#L37) |
| `liveEvalRunnerInternals` | White-box helpers used by live eval runner tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/agent-service/live-evals/runner.ts#L631) |
