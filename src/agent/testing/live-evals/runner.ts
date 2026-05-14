import {
  agUiSseEventTypes,
  type AgUiSseProgressSnapshot as EvalProgressSnapshot,
  buildAgUiSseTraceSignature as buildTraceSignature,
  getAgUiSseStringField as getStringField,
  parseAgUiSseResponse as parseSseResponse,
  type ParsedAgUiSseRun as ParsedRun,
} from "#veryfront/agent";
import { buildFailureSuffix, buildProgressLine, containsOrderedSubsequence } from "./formatting.ts";
import { type LiveEvalRuntime } from "./performance.ts";
import { buildLiveEvalRequestBody } from "./request.ts";
import { type LiveEvalCaseMetadata } from "./report.ts";
import {
  createFailedEvalResult,
  createPassedEvalResult,
  createSkippedEvalResult,
  type LiveEvalResultRecord,
} from "./result.ts";

export interface PreparedLiveEvalInput {
  prompt?: string;
  metadata?: Record<string, string>;
  verificationContext?: LiveEvalContext;
  cleanup?: () => Promise<void>;
  startSidecar?: () => Promise<(() => Promise<void>) | void>;
}

export interface LiveEvalContext {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
}

export interface LiveEvalCase {
  readonly id: string;
  readonly label: string;
  readonly prompt?: string;
  allowedTools?: string[];
  forceRuntimeOverrides?: boolean;
  requireProject?: boolean;
  maxSteps?: number;
  expectedEventSubsequence?: string[];
  metadata?: LiveEvalCaseMetadata;
  prepare?: (context: LiveEvalContext) => Promise<PreparedLiveEvalInput>;
  verify: (
    run: ParsedRun,
    prepared: PreparedLiveEvalInput | null,
  ) => string | null | Promise<string | null>;
}

interface FileCheckInput {
  filePath: string;
  requiredContent?: string[];
  description?: string;
}

export interface LiveEvalProjectFile {
  path: string;
  content: string;
}

export interface LiveEvalProjectFileReaderInput {
  filePath: string;
  requestTimeoutMs: number;
}

export interface LiveEvalRunnerConfig {
  endpoint: string;
  authToken: string;
  apiUrl: string;
  projectId: string | null;
  branchId: string | null;
  model: string | null;
  requestTimeoutMs: number;
  progressLogIntervalMs: number;
  enableLlmJudge: boolean;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  log?: (message: string) => void;
  readProjectFile?: (input: LiveEvalProjectFileReaderInput) => Promise<LiveEvalProjectFile | null>;
}

interface LiveEvalJudgeInput {
  question: string;
  criteria: string;
}

interface LiveEvalJudgeRequest extends LiveEvalJudgeInput {
  answer: string;
}

interface LiveEvalJudgeResult {
  pass: boolean;
  reason: string;
}

function resolveFetch(config: Pick<LiveEvalRunnerConfig, "fetch">) {
  return config.fetch ?? fetch;
}

function createLiveEvalJudgeSupport(
  config: Pick<LiveEvalRunnerConfig, "endpoint" | "authToken" | "enableLlmJudge" | "fetch">,
): {
  judgeLlm: (input: LiveEvalJudgeRequest) => Promise<LiveEvalJudgeResult>;
  withJudge: (
    structuralVerify: (run: ParsedRun) => string | null,
    judgeInput: LiveEvalJudgeInput,
  ) => (run: ParsedRun) => Promise<string | null>;
} {
  async function judgeLlm(input: LiveEvalJudgeRequest): Promise<LiveEvalJudgeResult> {
    try {
      const body = buildLiveEvalRequestBody({
        testCaseId: "llm-judge",
        prompt: `You are an eval judge. Grade the following answer.

QUESTION: ${input.question}

ANSWER: ${input.answer}

CRITERIA: ${input.criteria}

Respond with exactly one line: PASS or FAIL followed by a brief reason.
Example: "PASS — correctly explains the pattern with accurate details"
Example: "FAIL — mentions the wrong file convention"`,
        projectId: null,
        allowedTools: [],
        forceRuntimeOverrides: true,
        maxSteps: 2,
      });

      const response = await resolveFetch(config)(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.authToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      const run = await parseSseResponse(response);
      if (run.responseStatus !== 200) {
        return { pass: false, reason: `judge returned HTTP ${run.responseStatus}` };
      }
      const line = run.text
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value.length > 0) ?? "";
      if (line.toUpperCase().startsWith("PASS")) {
        return { pass: true, reason: line };
      }
      return { pass: false, reason: line || "judge returned no decision" };
    } catch (error) {
      return {
        pass: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function withJudge(
    structuralVerify: (run: ParsedRun) => string | null,
    judgeInput: LiveEvalJudgeInput,
  ): (run: ParsedRun) => Promise<string | null> {
    return async (run) => {
      const structuralFailure = structuralVerify(run);
      if (structuralFailure) {
        return structuralFailure;
      }
      if (!config.enableLlmJudge) {
        return null;
      }
      const judgment = await judgeLlm({
        question: judgeInput.question,
        answer: run.text,
        criteria: judgeInput.criteria,
      });
      return judgment.pass ? null : `LLM judge: ${judgment.reason}`;
    };
  }

  return {
    judgeLlm,
    withJudge,
  };
}

interface LiveEvalProgressReporter {
  stop: () => void;
  update: (snapshot: EvalProgressSnapshot) => void;
  getSnapshot: () => EvalProgressSnapshot;
}

function createInitialProgressSnapshot(): EvalProgressSnapshot {
  return {
    eventCount: 0,
    lastEventType: null,
    lastToolCallName: null,
    toolStarts: [],
    textLength: 0,
  };
}

interface UnrefableTimer {
  unref: () => void;
}

function isUnrefableTimer(value: unknown): value is UnrefableTimer {
  return typeof value === "object" && value !== null && "unref" in value &&
    typeof value.unref === "function";
}

function maybeUnrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (isUnrefableTimer(timer)) {
    timer.unref();
  }
}

function createLiveEvalProgressReporter(input: {
  caseId: string;
  startedAt: number;
  intervalMs: number;
  log: (message: string) => void;
}): LiveEvalProgressReporter {
  let latestProgress = createInitialProgressSnapshot();
  const progressTimer = setInterval(() => {
    input.log(
      buildProgressLine({
        caseId: input.caseId,
        startedAt: input.startedAt,
        progress: latestProgress,
      }),
    );
  }, input.intervalMs);
  maybeUnrefTimer(progressTimer);

  return {
    stop: () => {
      clearInterval(progressTimer);
    },
    update: (snapshot) => {
      latestProgress = snapshot;
    },
    getSnapshot: () => latestProgress,
  };
}

function collectPreparedArtifactPaths(prepared: PreparedLiveEvalInput | null): string[] {
  if (!prepared?.metadata) {
    return [];
  }

  return [
    ...new Set(
      Object.entries(prepared.metadata)
        .filter(([key, value]) => key.toLowerCase().includes("path") && value.length > 0)
        .map(([, value]) => value),
    ),
  ].sort();
}

function extractPreparedConversationId(prepared: PreparedLiveEvalInput | null): string | null {
  return typeof prepared?.metadata?.conversationId === "string" &&
      prepared.metadata.conversationId.length > 0
    ? prepared.metadata.conversationId
    : null;
}

interface LiveEvalResultContext {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  startedAt: number;
  conversationId?: string | null;
  artifactPaths?: string[];
}

interface LiveEvalRunArtifactsInput {
  run: ParsedRun;
  runId?: string;
  traceSignature: string;
}

interface LiveEvalRunArtifacts {
  runId?: string;
  traceSignature: string;
  toolStarts: string[];
  toolArgsPreview: string;
  textPreview: string;
}

function createLiveEvalRunArtifacts(input: LiveEvalRunArtifactsInput): LiveEvalRunArtifacts {
  return {
    ...(input.runId ? { runId: input.runId } : {}),
    traceSignature: input.traceSignature,
    toolStarts: input.run.toolStarts,
    toolArgsPreview: input.run.toolArgs.join(" | ").slice(0, 1000),
    textPreview: input.run.text.slice(0, 280),
  };
}

function createFailedRunEvalResult(input: {
  details: string;
  context: LiveEvalResultContext;
  runArtifacts: LiveEvalRunArtifacts;
}): LiveEvalResultRecord {
  return createFailedEvalResult({
    id: input.context.id,
    label: input.context.label,
    runtime: input.context.runtime,
    details: input.details,
    startedAt: input.context.startedAt,
    ...(input.context.conversationId ? { conversationId: input.context.conversationId } : {}),
    ...(input.runArtifacts.runId ? { runId: input.runArtifacts.runId } : {}),
    ...(input.context.artifactPaths?.length ? { artifactPaths: input.context.artifactPaths } : {}),
    traceSignature: input.runArtifacts.traceSignature,
    toolStarts: input.runArtifacts.toolStarts,
    toolArgsPreview: input.runArtifacts.toolArgsPreview,
    textPreview: input.runArtifacts.textPreview,
  });
}

function createPassedRunEvalResult(input: {
  details: string;
  context: LiveEvalResultContext;
  runArtifacts: LiveEvalRunArtifacts;
}): LiveEvalResultRecord {
  return createPassedEvalResult({
    id: input.context.id,
    label: input.context.label,
    runtime: input.context.runtime,
    details: input.details,
    startedAt: input.context.startedAt,
    ...(input.context.conversationId ? { conversationId: input.context.conversationId } : {}),
    ...(input.runArtifacts.runId ? { runId: input.runArtifacts.runId } : {}),
    ...(input.context.artifactPaths?.length ? { artifactPaths: input.context.artifactPaths } : {}),
    traceSignature: input.runArtifacts.traceSignature,
    toolStarts: input.runArtifacts.toolStarts,
    toolArgsPreview: input.runArtifacts.toolArgsPreview,
    textPreview: input.runArtifacts.textPreview,
  });
}

function createStreamingFailureEvalResult(input: {
  details: string;
  context: LiveEvalResultContext;
  progress: EvalProgressSnapshot;
}): LiveEvalResultRecord {
  return createFailedEvalResult({
    id: input.context.id,
    label: input.context.label,
    runtime: input.context.runtime,
    details: `${input.details}${buildFailureSuffix(input.progress)}`,
    startedAt: input.context.startedAt,
    ...(input.context.conversationId ? { conversationId: input.context.conversationId } : {}),
    ...(input.context.artifactPaths?.length ? { artifactPaths: input.context.artifactPaths } : {}),
    toolStarts: input.progress.toolStarts,
    textPreview: input.progress.textLength > 0
      ? `${input.progress.textLength} characters streamed`
      : undefined,
  });
}

function createLiveEvalResultContext(input: {
  testCase: LiveEvalCase;
  runtime: LiveEvalRuntime;
  startedAt: number;
  conversationId: string | null;
  artifactPaths: string[];
}): LiveEvalResultContext {
  return {
    id: input.testCase.id,
    label: input.testCase.label,
    runtime: input.runtime,
    startedAt: input.startedAt,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.artifactPaths.length > 0 ? { artifactPaths: input.artifactPaths } : {}),
  };
}

function buildLiveEvalRunBody(input: {
  config: LiveEvalRunnerConfig;
  testCase: LiveEvalCase;
  prepared: PreparedLiveEvalInput | null;
  conversationId: string | null;
}): unknown {
  const customBody = typeof input.prepared?.metadata?.customBody === "string"
    ? input.prepared.metadata.customBody
    : null;

  if (customBody) {
    return JSON.parse(customBody);
  }

  return buildLiveEvalRequestBody({
    testCaseId: input.testCase.id,
    prompt: input.prepared?.prompt ?? input.testCase.prompt ?? "",
    metadata: input.prepared?.metadata,
    projectId: input.config.projectId && input.testCase.requireProject
      ? input.config.projectId
      : null,
    ...(input.config.branchId ? { branchId: input.config.branchId } : {}),
    ...(input.config.model ? { model: input.config.model } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    allowedTools: input.testCase.allowedTools,
    forceRuntimeOverrides: input.testCase.forceRuntimeOverrides,
    maxSteps: input.testCase.maxSteps,
  });
}

async function resolveCompletedLiveEvalRun(input: {
  testCase: LiveEvalCase;
  run: ParsedRun;
  prepared: PreparedLiveEvalInput | null;
  context: LiveEvalResultContext;
  runId?: string;
}): Promise<LiveEvalResultRecord> {
  const traceSignature = buildTraceSignature(input.run.eventTypes);
  const runArtifacts = createLiveEvalRunArtifacts({
    run: input.run,
    runId: input.runId,
    traceSignature,
  });
  const failure = await input.testCase.verify(input.run, input.prepared);

  if (!failure && input.testCase.expectedEventSubsequence) {
    if (
      !containsOrderedSubsequence(input.run.eventTypes, input.testCase.expectedEventSubsequence)
    ) {
      return createFailedRunEvalResult({
        context: input.context,
        details: `Expected AG-UI event subsequence ${
          input.testCase.expectedEventSubsequence.join(" -> ")
        }, got ${traceSignature}`,
        runArtifacts,
      });
    }
  }

  if (failure) {
    return createFailedRunEvalResult({
      context: input.context,
      details: failure,
      runArtifacts,
    });
  }

  return createPassedRunEvalResult({
    context: input.context,
    details: `OK: ${input.run.toolStarts.join(", ") || "no tools"} | ${
      input.run.text.slice(0, 140) || "no text"
    }`,
    runArtifacts,
  });
}

function extractRunId(run: ParsedRun): string | null {
  for (const event of run.events) {
    const runId = getStringField(event, "runId") ?? getStringField(event, "run_id");
    if (runId) {
      return runId;
    }
  }

  return null;
}

export function hasFinished(run: ParsedRun): boolean {
  return run.eventTypes.includes(agUiSseEventTypes.runFinished) && !run.runError;
}

export function containsSkillLoad(run: ParsedRun, skillId: string): boolean {
  return run.toolStarts.includes("load_skill") && run.toolArgs.join("").includes(skillId);
}

export function countStepStartedEvents(run: ParsedRun): number {
  return run.eventTypes.filter((eventType) => eventType === agUiSseEventTypes.stepStarted).length;
}

export function createLiveEvalCaseSupport(config: LiveEvalRunnerConfig): {
  runEval: (testCase: LiveEvalCase, runtime: LiveEvalRuntime) => Promise<LiveEvalResultRecord>;
  verifyFileExists: (input: FileCheckInput) => Promise<string | null>;
  withJudge: (
    structuralVerify: (run: ParsedRun) => string | null,
    judgeInput: LiveEvalJudgeInput,
  ) => (run: ParsedRun) => Promise<string | null>;
  judgeLlm: (input: LiveEvalJudgeRequest) => Promise<LiveEvalJudgeResult>;
} {
  const fetchImpl = resolveFetch(config);
  const log = config.log ?? console.log;
  const { judgeLlm, withJudge } = createLiveEvalJudgeSupport(config);

  async function verifyFileExists(input: FileCheckInput): Promise<string | null> {
    if (!config.projectId || !config.readProjectFile) {
      return null;
    }

    const file = await config.readProjectFile({
      filePath: input.filePath,
      requestTimeoutMs: config.requestTimeoutMs,
    });

    if (!file) {
      return `${
        input.description ?? input.filePath
      }: file not found in project after task completed`;
    }

    if (!file.content || file.content.trim().length === 0) {
      return `${input.description ?? input.filePath}: file exists but is empty`;
    }

    if (input.requiredContent) {
      const missing = input.requiredContent.filter((keyword) =>
        !file.content.toLowerCase().includes(keyword.toLowerCase())
      );
      if (missing.length > 0) {
        return `${input.description ?? input.filePath}: missing required content: ${
          missing.join(", ")
        }. Got: ${file.content.slice(0, 200)}`;
      }
    }

    return null;
  }

  async function runEval(
    testCase: LiveEvalCase,
    runtime: LiveEvalRuntime,
  ): Promise<LiveEvalResultRecord> {
    const startedAt = Date.now();
    if (testCase.requireProject && !config.projectId) {
      return createSkippedEvalResult({
        id: testCase.id,
        label: testCase.label,
        runtime,
        details: "Skipped because AG_UI_EVAL_PROJECT_ID is not set.",
        startedAt,
      });
    }

    const prepared = testCase.prepare
      ? await testCase.prepare({
        apiUrl: config.apiUrl,
        authToken: config.authToken,
        projectId: config.projectId,
      })
      : null;
    const preparedConversationId = extractPreparedConversationId(prepared);
    const preparedArtifactPaths = collectPreparedArtifactPaths(prepared);
    const resultContext = createLiveEvalResultContext({
      testCase,
      runtime,
      startedAt,
      conversationId: preparedConversationId,
      artifactPaths: preparedArtifactPaths,
    });

    try {
      const sidecarCleanup = prepared?.startSidecar ? await prepared.startSidecar() : undefined;
      const progressReporter = createLiveEvalProgressReporter({
        caseId: testCase.id,
        startedAt,
        intervalMs: config.progressLogIntervalMs,
        log,
      });

      const body = buildLiveEvalRunBody({
        config,
        testCase,
        prepared,
        conversationId: preparedConversationId,
      });

      try {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.authToken}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        });

        log(`[stream] ${runtime}:${testCase.id} HTTP ${response.status}`);

        const run = await parseSseResponse(response, {
          onProgress: progressReporter.update,
        });
        return resolveCompletedLiveEvalRun({
          testCase,
          run,
          prepared,
          context: resultContext,
          runId: extractRunId(run) ?? undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createStreamingFailureEvalResult({
          context: resultContext,
          details: message,
          progress: progressReporter.getSnapshot(),
        });
      } finally {
        progressReporter.stop();
        await sidecarCleanup?.();
      }
    } finally {
      await prepared?.cleanup?.();
    }
  }

  return {
    judgeLlm,
    runEval,
    verifyFileExists,
    withJudge,
  };
}

export const liveEvalRunnerInternals = {
  collectPreparedArtifactPaths,
  createFailedRunEvalResult,
  createLiveEvalRunArtifacts,
  createPassedRunEvalResult,
  createStreamingFailureEvalResult,
  extractRunId,
};
