/**
 * First-class eval primitives for agent quality checks.
 *
 * @module eval
 *
 * @example
 * ```ts
 * import { datasets, evalAgent, metrics } from "veryfront/eval";
 *
 * export default evalAgent({
 *   target: "agent:researcher",
 *   dataset: datasets.inline([
 *     { id: "q1", input: "Capital of France?", reference: "Paris" },
 *   ]),
 *   metrics: [
 *     metrics.answer.contains({ text: "Paris" }).gate(),
 *     metrics.agent.noFailedTools().gate(),
 *   ],
 * });
 * ```
 *
 * @example Live agent-service eval
 * ```ts
 * import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
 * import { createAgentServiceEvalAdapter } from "veryfront/eval/agent-service";
 *
 * const definition = evalAgent({
 *   target: "agent:veryfront",
 *   dataset: datasets.inline([{ id: "smoke", input: "List project files." }]),
 *   metrics: [metrics.agent.noFailedTools().gate()],
 * });
 *
 * const report = await runEval(definition, {
 *   adapters: {
 *     agent: createAgentServiceEvalAdapter({
 *       endpoint: "http://127.0.0.1:3001/api/ag-ui",
 *       authToken: "<TOKEN>",
 *       projectId: "<PROJECT_ID>",
 *     }),
 *   },
 * });
 * ```
 */

export { datasets } from "./datasets.ts";
export { evalAgent, isEvalDefinition } from "./factory.ts";
export { metrics } from "./metrics.ts";
export { createEvalReport, summarizeEvalRecords } from "./report.ts";
export { compareEvalReports } from "./baseline.ts";
export { runEval } from "./runner.ts";
export { deriveEvalId, discoverEvals, findEvalById } from "./discovery.ts";
export {
  createEvalSourceDocument,
  getEvalEditableFieldSchema,
  getEvalRunSchema,
  getEvalSourceDocumentSchema,
  getEvalSourcePatchSchema,
  getEvalSourceReferenceSchema,
  getEvalStudioCapabilitySchema,
} from "./studio.ts";

export type { DiscoveredEval, EvalDiscoveryOptions, EvalDiscoveryResult } from "./discovery.ts";
export type {
  EvalAgentAdapter,
  EvalAgentAdapterContext,
  EvalAgentAdapterResult,
  EvalAgentInput,
  EvalCheckContext,
  EvalDataset,
  EvalDatasetLoadContext,
  EvalDefinition,
  EvalDurationSummary,
  EvalExample,
  EvalExampleInput,
  EvalExpect,
  EvalExpectation,
  EvalFailedExampleSummary,
  EvalFlakeSummary,
  EvalGateFailureSummary,
  EvalMetric,
  EvalMetricContext,
  EvalMetricDeltaSummary,
  EvalMetricFamily,
  EvalMetricResult,
  EvalMetricSummary,
  EvalMetricThreshold,
  EvalRecord,
  EvalReport,
  EvalReportComparison,
  EvalReportExportConfig,
  EvalReportSummary,
  EvalSeverity,
  EvalSource,
  EvalTargetKind,
  EvalToolCall,
  EvalTrace,
  EvalUsage,
  EvalUsageSummary,
  RunEvalOptions,
} from "./types.ts";
export type {
  CreateEvalSourceDocumentOptions,
  EvalEditableField,
  EvalRun,
  EvalSourceDocument,
  EvalSourcePatch,
  EvalSourceReference,
  EvalStudioCapability,
} from "./studio.ts";
