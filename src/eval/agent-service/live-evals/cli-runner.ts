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
import { createFailedEvalResult, type LiveEvalResultRecord } from "./result.ts";
import {
  assertEvalTimerDuration,
  normalizeEvalString,
  stringifyEvalError,
} from "../../validation.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

type EnvRecord = Record<string, string | undefined>;

/** Public API contract for live eval cli case groups. */
export interface LiveEvalCliCaseGroups {
  readOnlyCases: LiveEvalCase[];
  writeCases: LiveEvalCase[];
  experimentalWriteCases: LiveEvalCase[];
}

/** Input payload for live eval cli case factory. */
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

/** Input payload for run live eval cli. */
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

function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  assertEvalTimerDuration(parsed, name, { min: 1 });
  return parsed;
}

function resolveLiveEvalRuntimes(
  runtimes: readonly LiveEvalRuntime[] | undefined,
): LiveEvalRuntime[] {
  const requested: readonly LiveEvalRuntime[] = runtimes ?? ["framework"];
  const resolved = [...new Set<LiveEvalRuntime>(requested)];
  if (resolved.length === 0) {
    throw new Error("At least one live eval runtime must be selected");
  }
  for (const runtime of resolved) {
    if (runtime !== "framework") {
      throw new Error(`Unsupported live eval runtime "${String(runtime)}"`);
    }
  }
  return resolved;
}

function validateLiveEvalCaseCatalog(groups: LiveEvalCliCaseGroups): void {
  const seenIds = new Set<string>();
  const groupNames: Array<keyof LiveEvalCliCaseGroups> = [
    "readOnlyCases",
    "writeCases",
    "experimentalWriteCases",
  ];
  for (const groupName of groupNames) {
    const cases = groups?.[groupName];
    if (!Array.isArray(cases)) {
      throw new Error(`Live eval case catalog ${groupName} must be an array`);
    }
    for (const [index, testCase] of cases.entries()) {
      if (typeof testCase !== "object" || testCase === null) {
        throw new Error(`${groupName}[${index}] must be a live eval case object`);
      }
      const id = normalizeEvalString(testCase.id, `${groupName}[${index}] id`);
      const label = normalizeEvalString(testCase.label, `${groupName}[${index}] label`);
      if (id !== testCase.id) {
        throw new Error(`${groupName}[${index}] id must not have surrounding whitespace`);
      }
      if (label !== testCase.label) {
        throw new Error(`${groupName}[${index}] label must not have surrounding whitespace`);
      }
      if (seenIds.has(id)) {
        throw new Error(`Duplicate live eval case id "${id}"`);
      }
      seenIds.add(id);
    }
  }
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

/** Run live eval cli. */
export async function runLiveEvalCli(input: RunLiveEvalCliInput): Promise<number> {
  const log = input.log ?? console.log;
  const error = input.error ?? console.error;
  const cwd = input.cwd ?? getProcessCwd();
  const { endpoint, authToken, apiUrl, projectId, branchId, model } = resolveLiveEvalEnvironment(
    input.env,
  );

  if (authToken.trim().length === 0) {
    error("Missing VERYFRONT_TOKEN");
    return 1;
  }

  let requestedRuntimeSelection: LiveEvalRuntime[];
  let requestTimeoutMs: number;
  let progressLogIntervalMs: number;
  try {
    requestedRuntimeSelection = resolveLiveEvalRuntimes(input.runtimes);
    requestTimeoutMs = parsePositiveIntegerEnv(
      input.env.AG_UI_EVAL_TIMEOUT_MS,
      240_000,
      "AG_UI_EVAL_TIMEOUT_MS",
    );
    progressLogIntervalMs = parsePositiveIntegerEnv(
      input.env.AG_UI_EVAL_PROGRESS_MS,
      15_000,
      "AG_UI_EVAL_PROGRESS_MS",
    );
  } catch (configurationError) {
    error(stringifyEvalError(configurationError));
    return 1;
  }

  const runWriteEvals = input.env.AG_UI_EVAL_WRITE === "1";
  const runExperimentalWriteEvals = input.env.AG_UI_EVAL_EXPERIMENTAL === "1";
  if (runExperimentalWriteEvals && !runWriteEvals) {
    error("AG_UI_EVAL_EXPERIMENTAL=1 requires AG_UI_EVAL_WRITE=1");
    return 1;
  }
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
  let runEval: ReturnType<typeof createLiveEvalCaseSupport>["runEval"];
  let groups: LiveEvalCliCaseGroups;
  try {
    const support = createCaseSupport({
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
    runEval = support.runEval;
    groups = input.createCases({
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
      verifyFileExists: support.verifyFileExists,
      withJudge: support.withJudge,
      judgeLlm: support.judgeLlm,
    });
    validateLiveEvalCaseCatalog(groups);
  } catch (configurationError) {
    error(stringifyEvalError(configurationError));
    return 1;
  }
  const { readOnlyCases, writeCases, experimentalWriteCases } = groups;

  log(`AG-UI live evals -> ${endpoint}`);
  log(`Veryfront API -> ${apiUrl}`);
  log(`Project scope -> ${projectId ?? "none"}`);
  log(`Runtime -> ${requestedRuntimeSelection.join(", ")}`);
  log(`Write evals -> ${runWriteEvals ? "enabled" : "disabled"}`);
  log(`Experimental evals -> ${runExperimentalWriteEvals ? "enabled" : "disabled"}`);
  log(`Case set -> ${requestedCaseSetId ?? "none"}`);
  log(`Case tags -> ${requestedCaseTags.size > 0 ? [...requestedCaseTags].join(", ") : "none"}`);

  const allCases = [...readOnlyCases, ...writeCases, ...experimentalWriteCases];
  let resolvedRequestedCaseIds: Set<string>;
  try {
    resolvedRequestedCaseIds = resolveLiveEvalRequestedCaseIds({
      caseSets: input.caseSets,
      requestedCaseIds,
      requestedCaseSetId,
    });
  } catch (selectionError) {
    error(stringifyEvalError(selectionError));
    return 1;
  }

  const knownCaseIds = new Set(allCases.map((testCase) => testCase.id));
  const unknownCaseIds = [...resolvedRequestedCaseIds].filter((id) => !knownCaseIds.has(id));
  if (unknownCaseIds.length > 0) {
    error(`Unknown live eval case ids: ${unknownCaseIds.toSorted(compareStrings).join(", ")}`);
    return 1;
  }
  const enabledCases = runWriteEvals
    ? [
      ...readOnlyCases,
      ...writeCases,
      ...(runExperimentalWriteEvals ? experimentalWriteCases : []),
    ]
    : readOnlyCases;
  const enabledCaseIds = new Set(enabledCases.map((testCase) => testCase.id));
  const disabledRequestedCaseIds = [...resolvedRequestedCaseIds].filter((id) =>
    !enabledCaseIds.has(id)
  );
  if (disabledRequestedCaseIds.length > 0) {
    error(
      `Requested live eval cases are not enabled by the write-eval flags: ${
        disabledRequestedCaseIds.toSorted(compareStrings).join(", ")
      }`,
    );
    return 1;
  }

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
      const caseStartedAt = Date.now();
      let result: LiveEvalResultRecord;
      try {
        result = await runEval(testCase, runtime);
      } catch (runError) {
        result = createFailedEvalResult({
          id: testCase.id,
          label: testCase.label,
          runtime,
          details: stringifyEvalError(runError),
          startedAt: caseStartedAt,
        });
      }
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

  return summary.failed > 0 || summary.passed === 0 ? 1 : 0;
}
