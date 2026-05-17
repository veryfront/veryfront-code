import { mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { dirname, resolve } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getProcessCwd } from "#veryfront/platform/compat/process.ts";
import { buildRuntimePerformanceSummary, type LiveEvalRuntime } from "./performance.ts";
import {
  buildLiveEvalCaseTagSummary,
  buildLiveEvalRuntimeSummary,
  buildLiveEvalStatusSummary,
  resolveLiveEvalRequestedCaseIds,
  selectLiveEvalCases,
} from "./report.ts";
import {
  containsSkillLoad,
  countStepStartedEvents,
  createLiveEvalCaseSupport,
  hasFinished,
  type LiveEvalCase,
  type LiveEvalRunnerConfig,
} from "./runner.ts";
import { getLiveEvalProjectFile, type LiveEvalApiContext } from "./api-client.ts";
import { resolveLiveEvalEnvironment } from "./environment.ts";
import type { LiveEvalResultRecord } from "./result.ts";

type EnvRecord = Record<string, string | undefined>;

export interface LiveEvalCliCaseGroups {
  readOnlyCases: LiveEvalCase[];
  writeCases: LiveEvalCase[];
  experimentalWriteCases: LiveEvalCase[];
}

export interface LiveEvalCliCaseFactoryInput {
  authToken: string;
  endpoint: string;
  projectId: string | null;
  branchId: string | null;
  model: string | null;
  requestTimeoutMs: number;
  enableLlmJudge: boolean;
  hasFinished: typeof hasFinished;
  containsSkillLoad: typeof containsSkillLoad;
  countStepStartedEvents: typeof countStepStartedEvents;
  verifyFileExists: ReturnType<typeof createLiveEvalCaseSupport>["verifyFileExists"];
  withJudge: ReturnType<typeof createLiveEvalCaseSupport>["withJudge"];
  judgeLlm: ReturnType<typeof createLiveEvalCaseSupport>["judgeLlm"];
}

export interface RunLiveEvalCliInput {
  env: EnvRecord;
  caseSets: Record<string, readonly string[]>;
  createCases: (input: LiveEvalCliCaseFactoryInput) => LiveEvalCliCaseGroups;
  runtimes?: readonly LiveEvalRuntime[];
  cwd?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  createCaseSupport?: (
    config: LiveEvalRunnerConfig,
  ) => ReturnType<typeof createLiveEvalCaseSupport>;
}

function splitCsvEnv(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function createTimestampedReportPath(input: {
  cwd: string;
  directory: string;
}): string {
  return resolve(
    input.cwd,
    ".omx/logs",
    input.directory,
    `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}.json`,
  );
}

export async function runLiveEvalCli(input: RunLiveEvalCliInput): Promise<number> {
  const log = input.log ?? console.log;
  const error = input.error ?? console.error;
  const cwd = input.cwd ?? getProcessCwd();
  const { endpoint, authToken, apiUrl, projectId, branchId, model } = resolveLiveEvalEnvironment(
    input.env,
  );
  const requestedRuntimeSelection = input.runtimes ?? ["framework"];
  const runWriteEvals = input.env.AG_UI_EVAL_WRITE === "1";
  const runExperimentalWriteEvals = input.env.AG_UI_EVAL_EXPERIMENTAL === "1";
  const requestTimeoutMs = Number(input.env.AG_UI_EVAL_TIMEOUT_MS ?? "240000");
  const progressLogIntervalMs = Number(input.env.AG_UI_EVAL_PROGRESS_MS ?? "15000");
  const reportPath = input.env.AG_UI_EVAL_REPORT_PATH ??
    createTimestampedReportPath({ cwd, directory: "ag-ui-live-evals" });
  const requestedCaseIds = splitCsvEnv(input.env.AG_UI_EVAL_CASES);
  const requestedCaseTags = splitCsvEnv(input.env.AG_UI_EVAL_TAGS);
  const requestedCaseSetId = input.env.AG_UI_EVAL_CASE_SET?.trim() || null;
  const enableLlmJudge = input.env.AG_UI_EVAL_LLM_JUDGE === "1";

  const apiContext: LiveEvalApiContext = {
    apiUrl,
    authToken,
    projectId: projectId ?? null,
  };
  const createCaseSupport = input.createCaseSupport ?? createLiveEvalCaseSupport;
  const { judgeLlm, runEval, verifyFileExists, withJudge } = createCaseSupport({
    endpoint,
    authToken,
    apiUrl,
    projectId: projectId ?? null,
    branchId: branchId ?? null,
    model: model ?? null,
    requestTimeoutMs,
    progressLogIntervalMs,
    enableLlmJudge,
    readProjectFile: (readerInput) => getLiveEvalProjectFile(apiContext, readerInput),
  });

  const { readOnlyCases, writeCases, experimentalWriteCases } = input.createCases({
    authToken,
    endpoint,
    projectId: projectId ?? null,
    branchId: branchId ?? null,
    model: model ?? null,
    requestTimeoutMs,
    enableLlmJudge,
    hasFinished,
    containsSkillLoad,
    countStepStartedEvents,
    verifyFileExists,
    withJudge,
    judgeLlm,
  });

  if (authToken.length === 0) {
    error("Missing VERYFRONT_TOKEN");
    return 1;
  }

  log(`AG-UI live evals -> ${endpoint}`);
  log(`Veryfront API -> ${apiUrl}`);
  log(`Project scope -> ${projectId ?? "none"}`);
  log(`Runtime -> ${requestedRuntimeSelection.join(", ")}`);
  log(`Write evals -> ${runWriteEvals ? "enabled" : "disabled"}`);
  log(`Experimental evals -> ${runExperimentalWriteEvals ? "enabled" : "disabled"}`);
  log(`Case set -> ${requestedCaseSetId ?? "none"}`);
  log(`Case tags -> ${requestedCaseTags.size > 0 ? [...requestedCaseTags].join(", ") : "none"}`);

  const allCases = [...readOnlyCases, ...writeCases, ...experimentalWriteCases];
  const resolvedRequestedCaseIds = resolveLiveEvalRequestedCaseIds({
    caseSets: input.caseSets,
    requestedCaseIds,
    requestedCaseSetId,
  });
  const cases = selectLiveEvalCases({
    allCases,
    readOnlyCases,
    writeCases,
    experimentalWriteCases,
    requestedCaseIds: resolvedRequestedCaseIds,
    requestedCaseTags,
    runWriteEvals,
    runExperimentalWriteEvals,
  });
  const selectedCaseTagSummary = buildLiveEvalCaseTagSummary(cases);

  if (cases.length === 0) {
    error("No eval cases selected.");
    return 1;
  }

  const results: LiveEvalResultRecord[] = [];

  for (const runtime of requestedRuntimeSelection) {
    log(`\n[runtime] ${runtime}`);
    for (const testCase of cases) {
      log(`\n[run] ${runtime} :: ${testCase.label}`);
      const result = await runEval(testCase, runtime);
      results.push(result);
      log(`[${runtime}] [${result.status}] ${result.details}`);
    }
  }

  const summary = buildLiveEvalStatusSummary(results);
  const runtimeSummary = buildLiveEvalRuntimeSummary(requestedRuntimeSelection, results);
  const runtimePerformanceSummary = buildRuntimePerformanceSummary(results);

  log("\nSummary");
  log(`passed: ${summary.passed}`);
  log(`failed: ${summary.failed}`);
  log(`skipped: ${summary.skipped}`);
  for (const runtime of requestedRuntimeSelection) {
    const currentRuntimeSummary = runtimeSummary[runtime];
    log(
      `${runtime}: passed=${currentRuntimeSummary.passed} failed=${currentRuntimeSummary.failed} skipped=${currentRuntimeSummary.skipped}`,
    );
    const performance = runtimePerformanceSummary[runtime];
    log(
      `${runtime}: avg=${performance.avgDurationMs}ms p50=${performance.p50DurationMs}ms p95=${performance.p95DurationMs}ms min=${performance.minDurationMs}ms max=${performance.maxDurationMs}ms`,
    );
  }

  await mkdir(dirname(reportPath), { recursive: true });
  await writeTextFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        endpoint,
        apiUrl,
        projectId: projectId ?? null,
        runtimes: requestedRuntimeSelection,
        writeEvals: runWriteEvals,
        requestedCaseIds: [...resolvedRequestedCaseIds],
        requestedCaseTags: [...requestedCaseTags],
        requestedCaseSetId,
        caseMetadata: Object.fromEntries(
          cases.map((testCase) => [testCase.id, testCase.metadata ?? { tags: [] }]),
        ),
        selectedCaseTagSummary,
        results,
        summary,
        runtimeSummary,
        runtimePerformanceSummary,
      },
      null,
      2,
    ),
  );
  log(`report: ${reportPath}`);

  return summary.failed > 0 ? 1 : 0;
}
