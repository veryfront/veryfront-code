/**
 * Agent Testing Utilities
 *
 * @module veryfront/agent/testing
 */

export {
  assertCompleted,
  assertContains,
  assertToolCalled,
  printTestResults,
  testAgent,
  type TestCase,
  type TestResult,
  type TestSuite,
} from "./agent-tester.ts";

export {
  createDurableRunCanaryApiClient,
  createDurableRunCanaryRunner,
  type DurableRunCanaryApiClient,
  type DurableRunCanaryApiConfig,
  type DurableRunCanaryCase,
  type DurableRunCanaryCreateRootRunInput,
  type DurableRunCanaryMessage,
  type DurableRunCanaryPreparedCase,
  type DurableRunCanaryResult,
  type DurableRunCanaryRunnerConfig,
  durableRunCanaryRunnerInternals,
  type DurableRunCanaryRunSummary,
  type DurableRunCanarySendUserMessageInput,
  type DurableRunCanaryStartRunInput,
  getDurableRunCanaryMessageSchema,
  parseDurableRunCanaryRunSummary,
} from "./durable-run-canaries/index.ts";

export {
  buildFailureSuffix,
  buildLiveEvalCaseTagSummary,
  buildLiveEvalRequestBody,
  type BuildLiveEvalRequestBodyInput,
  buildLiveEvalRuntimeSummary,
  buildLiveEvalStatusSummary,
  buildProgressLine,
  buildRuntimePerformanceSummary,
  containsOrderedSubsequence,
  containsSkillLoad,
  countStepStartedEvents,
  createFailedEvalResult,
  createLiveEvalCaseSupport,
  createPassedEvalResult,
  createPlainTextPdf,
  createSkippedEvalResult,
  hasEveryLiveEvalTag,
  hasFinished,
  type LiveEvalCase,
  type LiveEvalCaseMetadata,
  type LiveEvalCaseSelectionInput,
  type LiveEvalContext,
  type LiveEvalProjectFile,
  type LiveEvalProjectFileReaderInput,
  type LiveEvalRequestBody,
  type LiveEvalResultForPerformance,
  type LiveEvalResultForReport,
  type LiveEvalResultRecord,
  type LiveEvalRunnerConfig,
  liveEvalRunnerInternals,
  type LiveEvalRuntime,
  type PreparedLiveEvalInput,
  resolveLiveEvalRequestedCaseIds,
  type RuntimePerformanceSummary,
  selectLiveEvalCases,
} from "./live-evals/index.ts";
