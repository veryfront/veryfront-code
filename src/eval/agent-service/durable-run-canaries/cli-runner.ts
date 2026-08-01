import { mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { ENV_VAR_MISSING, INVALID_ARGUMENT } from "#veryfront/errors";
import { dirname, resolve } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getProcessCwd } from "#veryfront/platform/compat/process.ts";
import { type LiveEvalApiContext } from "../live-evals/api-client.ts";
import { resolveDurableRunCanaryEnvironment } from "./environment.ts";
import {
  createDurableRunCanaryRunner,
  type DurableRunCanaryCase,
  type DurableRunCanaryResult,
  type DurableRunCanaryRunnerConfig,
} from "./runner.ts";
import { assertCanonicalEvalString, stringifyEvalError } from "../../validation.ts";

type EnvRecord = Record<string, string | undefined>;

/** Input payload for durable run canary cli case factory. */
export interface DurableRunCanaryCliCaseFactoryInput {
  context: LiveEvalApiContext;
  requestTimeoutMs: number;
}

/** Input payload for run durable run canary cli. */
export interface RunDurableRunCanaryCliInput {
  env: EnvRecord;
  agentId: string;
  createCases: (input: DurableRunCanaryCliCaseFactoryInput) => DurableRunCanaryCase[];
  cwd?: string;
  log?: (message: string) => void;
  createRunner?: (
    config: DurableRunCanaryRunnerConfig,
  ) => ReturnType<typeof createDurableRunCanaryRunner>;
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

function validateDurableRunCanaryCases(testCases: DurableRunCanaryCase[]): void {
  if (!Array.isArray(testCases)) {
    throw INVALID_ARGUMENT.create({ detail: "Durable run canary cases must be an array" });
  }
  if (testCases.length === 0) {
    throw INVALID_ARGUMENT.create({ detail: "No durable run canary cases were selected" });
  }

  const seenIds = new Set<string>();
  for (const [index, testCase] of testCases.entries()) {
    if (typeof testCase !== "object" || testCase === null) {
      throw INVALID_ARGUMENT.create({
        detail: `Durable canary case[${index}] must be an object`,
      });
    }
    assertCanonicalEvalString(testCase.id, `Durable canary case[${index}] id`);
    assertCanonicalEvalString(testCase.label, `Durable canary case[${index}] label`);
    const id = testCase.id;
    if (seenIds.has(id)) {
      throw INVALID_ARGUMENT.create({ detail: `Duplicate durable canary case id "${id}"` });
    }
    seenIds.add(id);
  }
}

/** Run durable run canary cli. */
export async function runDurableRunCanaryCli(
  input: RunDurableRunCanaryCliInput,
): Promise<number> {
  const log = input.log ?? console.log;
  const cwd = input.cwd ?? getProcessCwd();
  const { apiUrl, authToken, projectId, model, requestTimeoutMs, keepSuccessfulEvidence } =
    resolveDurableRunCanaryEnvironment(input.env);
  const reportPath = input.env.DURABLE_CANARY_REPORT_PATH ??
    createTimestampedReportPath({ cwd, directory: "durable-run-staging-canaries" });

  if (!authToken) {
    throw ENV_VAR_MISSING.create({ detail: "Missing VERYFRONT_TOKEN" });
  }
  if (!projectId) {
    throw ENV_VAR_MISSING.create({ detail: "Missing AG_UI_EVAL_PROJECT_ID" });
  }

  const context: LiveEvalApiContext = {
    apiUrl,
    authToken,
    projectId,
  };
  const createRunner = input.createRunner ?? createDurableRunCanaryRunner;
  const { runCase } = createRunner({
    apiUrl,
    authToken,
    agentId: input.agentId,
    projectId,
    model,
    requestTimeoutMs,
    keepSuccessfulEvidence,
  });
  const testCases = input.createCases({
    context,
    requestTimeoutMs,
  });
  validateDurableRunCanaryCases(testCases);

  log(`Durable run canaries -> ${apiUrl}`);
  log(`Project scope -> ${projectId}`);
  log(`Model -> ${model ?? "runtime default"}`);

  const results: DurableRunCanaryResult[] = [];
  for (const testCase of testCases) {
    log(`\n[run] ${testCase.label}`);
    const startedAt = Date.now();
    let result: DurableRunCanaryResult;
    try {
      result = await runCase(testCase);
    } catch (error) {
      result = {
        id: testCase.id,
        label: testCase.label,
        status: "fail",
        details: stringifyEvalError(error),
        durationMs: Date.now() - startedAt,
        conversationId: "unknown",
        runId: "unknown",
        runIds: [],
      };
    }
    results.push(result);
    log(`[${result.status}] ${result.id}: ${result.details}`);
  }

  const summary = {
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeTextFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiUrl,
        projectId,
        model: model ?? null,
        results,
        summary,
      },
      null,
      2,
    ),
  );

  log("\nSummary");
  log(`passed: ${summary.passed}`);
  log(`failed: ${summary.failed}`);
  log(`report: ${reportPath}`);

  return summary.failed > 0 ? 1 : 0;
}
