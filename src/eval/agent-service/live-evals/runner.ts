import {
  agUiSseEventTypes,
  type AgUiSseProgressSnapshot as EvalProgressSnapshot,
  buildAgUiSseTraceSignature as buildTraceSignature,
  getAgUiSseStringField as getStringField,
  parseAgUiSseResponse as parseSseResponse,
  type ParsedAgUiSseRun as ParsedRun,
} from "#veryfront/agent";
import { coerceWireEvent } from "#veryfront/agent/ag-ui/sse-parser.ts";
import {
  createRunsSdk,
  type RunsInput,
  type RunStreamFrame,
} from "#veryfront/runs/target/index.ts";
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
import {
  assertCanonicalEvalString,
  assertEvalTimerDuration,
  createEvalValidationError,
  stringifyEvalError,
} from "../../validation.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

/** Input payload for prepared live eval. */
export interface PreparedLiveEvalInput {
  prompt?: string;
  metadata?: Record<string, string>;
  verificationContext?: LiveEvalContext;
  cleanup?: () => Promise<void>;
  startSidecar?: () => Promise<(() => Promise<void>) | void>;
}

/** Context for live eval. */
export interface LiveEvalContext {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
}

/** Public API contract for live eval case. */
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

/** Public API contract for live eval project file. */
export interface LiveEvalProjectFile {
  path: string;
  content: string;
}

/** Input payload for live eval project file reader. */
export interface LiveEvalProjectFileReaderInput {
  filePath: string;
  requestTimeoutMs: number;
}

/** Configuration used by live eval runner. */
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

function assertLiveEvalRunnerConfig(config: LiveEvalRunnerConfig): void {
  assertCanonicalEvalString(config.endpoint, "Live eval endpoint");
  assertCanonicalEvalString(config.apiUrl, "Live eval API URL");
  if (!URL.canParse(config.apiUrl)) {
    throw new TypeError("Live eval API URL must be a valid absolute URL");
  }
  assertCanonicalEvalString(config.authToken, "Live eval auth token");
  if (config.projectId !== null) {
    assertCanonicalEvalString(config.projectId, "Live eval project id");
  }
  if (config.branchId !== null) {
    assertCanonicalEvalString(config.branchId, "Live eval branch id");
  }
  if (config.model !== null) {
    assertCanonicalEvalString(config.model, "Live eval model");
  }
  if (config.fetch !== undefined && typeof config.fetch !== "function") {
    throw new TypeError("Live eval fetch must be a function");
  }
  if (config.log !== undefined && typeof config.log !== "function") {
    throw new TypeError("Live eval log must be a function");
  }
  if (config.readProjectFile !== undefined && typeof config.readProjectFile !== "function") {
    throw new TypeError("Live eval readProjectFile must be a function");
  }
  assertEvalTimerDuration(config.requestTimeoutMs, "Live eval requestTimeoutMs", {
    min: 1,
  });
  assertEvalTimerDuration(
    config.progressLogIntervalMs,
    "Live eval progressLogIntervalMs",
    { min: 1 },
  );
}

function createLiveEvalJudgeSupport(
  config: Pick<
    LiveEvalRunnerConfig,
    | "endpoint"
    | "authToken"
    | "projectId"
    | "branchId"
    | "model"
    | "requestTimeoutMs"
    | "enableLlmJudge"
    | "fetch"
  >,
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
        projectId: config.projectId,
        ...(config.branchId ? { branchId: config.branchId } : {}),
        ...(config.model ? { model: config.model } : {}),
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
        signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 30_000)),
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
        reason: stringifyEvalError(error),
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
  ].sort(compareStrings);
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

async function captureLiveEvalCleanupFailure(
  label: string,
  cleanup: (() => Promise<void>) | undefined,
): Promise<string | null> {
  if (!cleanup) return null;
  try {
    await cleanup();
    return null;
  } catch (error) {
    return `${label}: ${stringifyEvalError(error)}`;
  }
}

function applyLiveEvalCleanupFailures(
  result: LiveEvalResultRecord,
  cleanupFailures: string[],
  startedAt: number,
): LiveEvalResultRecord {
  if (cleanupFailures.length === 0) return result;
  return {
    ...result,
    status: "fail",
    details: `${result.details} Cleanup failed: ${cleanupFailures.join("; ")}`,
    durationMs: Date.now() - startedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLiveEvalApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

function createLiveEvalRunsSdk(input: {
  apiUrl: string;
  authToken: string;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  onResponse?: (input: { path: string; response: Response }) => void;
}) {
  const baseUrl = normalizeLiveEvalApiUrl(input.apiUrl);
  return createRunsSdk({
    transport: {
      request: async (path, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${input.authToken}`);
        const url = `${baseUrl}${path}`;
        const response = await input.fetch(url, {
          method: init.method,
          headers,
          body: init.body,
          signal: init.signal,
          redirect: "error",
        });
        input.onResponse?.({ path, response });
        if (!init.onResponse) return response;
        return await init.onResponse(response, init, url, init.signal);
      },
    },
  });
}

function buildCanonicalLiveEvalInput(input: {
  config: LiveEvalRunnerConfig;
  testCase: LiveEvalCase;
  prepared: PreparedLiveEvalInput | null;
  conversationId: string;
  userMessageId: string;
}): Record<string, unknown> {
  const runtimeOverrides = input.testCase.allowedTools !== undefined ||
      input.testCase.forceRuntimeOverrides ||
      input.testCase.maxSteps !== undefined
    ? {
      ...(input.testCase.allowedTools !== undefined
        ? { allowedTools: input.testCase.allowedTools }
        : input.testCase.forceRuntimeOverrides
        ? { allowedTools: [] }
        : {}),
      ...(input.testCase.maxSteps !== undefined ? { maxSteps: input.testCase.maxSteps } : {}),
    }
    : undefined;
  const veryfront = {
    projectId: input.config.projectId,
    conversationId: input.conversationId,
    branchId: input.config.branchId ?? null,
    ...(input.config.model ? { model: input.config.model } : {}),
    ...(runtimeOverrides ? { runtimeOverrides } : {}),
  };
  const forwardedProps = {
    ...(input.config.model ? { model: input.config.model } : {}),
    ...(runtimeOverrides ? { runtimeOverrides } : {}),
    veryfront,
  };

  return {
    messages: [
      {
        id: input.userMessageId,
        role: "user",
        parts: [{ type: "text", text: input.prepared?.prompt ?? input.testCase.prompt ?? "" }],
      },
    ],
    context: {
      conversationId: input.conversationId,
      projectId: input.config.projectId,
      branchId: input.config.branchId ?? null,
    },
    forwardedProps,
  };
}

function assertCanonicalConversationInputSupported(input: {
  prepared: PreparedLiveEvalInput | null;
}): void {
  if (typeof input.prepared?.metadata?.customBody === "string") {
    throw createEvalValidationError(
      "Conversation-backed live evals do not support metadata.customBody; canonical run admission owns the request body",
    );
  }
}

function buildCanonicalLiveEvalCreateRunBody(input: {
  config: LiveEvalRunnerConfig;
  testCase: LiveEvalCase;
  prepared: PreparedLiveEvalInput | null;
  conversationId: string;
  userMessageId: string;
  clientRunId: string;
}): RunsInput<"createRun">["body"] {
  if (!input.config.projectId) {
    throw createEvalValidationError(
      "Conversation-backed live evals require AG_UI_EVAL_PROJECT_ID for canonical run admission",
    );
  }

  assertCanonicalConversationInputSupported(input);

  const body = {
    project_id: input.config.projectId,
    title: input.testCase.label,
    target: { type: "agent", id: "veryfront" },
    conversation_id: input.conversationId,
    execution: {
      runtime: input.config.branchId
        ? { type: "preview_branch", id: input.config.branchId }
        : { type: "main_branch" },
    },
    input: buildCanonicalLiveEvalInput(input),
    config: {
      agent_admission: {
        mode: "hosted",
        input_message_id: input.userMessageId,
        client_run_id: input.clientRunId,
      },
    },
  } satisfies RunsInput<"createRun">["body"];
  return body;
}

function readCreatedRunId(result: unknown): string {
  if (isRecord(result)) {
    const id = result.id;
    if (typeof id === "string" && id.length > 0) return id;
    const runId = result.run_id;
    if (typeof runId === "string" && runId.length > 0) return runId;
  }
  throw createEvalValidationError("Canonical live eval run admission did not return a run id");
}

function createCanonicalParsedRun(responseStatus: number): ParsedRun {
  return {
    responseStatus,
    events: [],
    eventTypes: [],
    toolStarts: [],
    toolArgs: [],
    text: "",
    runError: null,
  };
}

function applyCanonicalParsedEvent(run: ParsedRun, event: Record<string, unknown>): void {
  run.events.push(event);
  const type = getStringField(event, "type");
  if (type) run.eventTypes.push(type);
  if (type === agUiSseEventTypes.toolCallStart) {
    const toolCallName = getStringField(event, "toolCallName") ??
      getStringField(event, "tool_call_name");
    if (toolCallName) run.toolStarts.push(toolCallName);
  } else if (type === agUiSseEventTypes.toolCallArgs) {
    const delta = getStringField(event, "delta");
    if (delta) run.toolArgs.push(delta);
  } else if (type === agUiSseEventTypes.textMessageContent) {
    const delta = getStringField(event, "delta");
    if (delta) run.text += delta;
  }
}

function normalizeCanonicalRunStreamFrame(frame: RunStreamFrame): Record<string, unknown> {
  const payload = frame.event.payload;
  if (typeof payload.type === "string") return payload;
  return coerceWireEvent(frame.event.event_type, payload);
}

function isTerminalCanonicalEvent(run: ParsedRun): boolean {
  return run.eventTypes.includes(agUiSseEventTypes.runFinished) ||
    run.eventTypes.includes(agUiSseEventTypes.runError);
}

async function cancelCanonicalLiveEvalRun(input: {
  sdk: ReturnType<typeof createRunsSdk>;
  runId: string;
  requestTimeoutMs: number;
}): Promise<void> {
  try {
    await input.sdk.cancelRun({
      path: { run_id: input.runId },
      headers: { "Idempotency-Key": `live-eval-cancel:${input.runId}` },
    }, { signal: AbortSignal.timeout(Math.min(input.requestTimeoutMs, 5_000)) });
  } catch {
    // Preserve the original streaming or admission error. Cancellation is best-effort cleanup.
  }
}

async function runCanonicalConversationLiveEval(input: {
  config: LiveEvalRunnerConfig;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  testCase: LiveEvalCase;
  prepared: PreparedLiveEvalInput | null;
  conversationId: string;
  progressReporter: LiveEvalProgressReporter;
}): Promise<{ run: ParsedRun; runId: string }> {
  let streamResponseStatus = 0;
  const sdk = createLiveEvalRunsSdk({
    apiUrl: input.config.apiUrl,
    authToken: input.config.authToken,
    fetch: input.fetch,
    onResponse: ({ path, response }) => {
      if (path.includes("/stream")) streamResponseStatus = response.status;
    },
  });
  const signal = AbortSignal.timeout(input.config.requestTimeoutMs);
  const userMessageId = crypto.randomUUID();
  const clientRunId = `run_${crypto.randomUUID()}`;
  let admittedRunId: string | null = null;
  let terminal = false;
  let cancelledAfterUnfinishedStream = false;
  try {
    const created = await sdk.createRun({
      headers: { "Idempotency-Key": `live-eval:${input.testCase.id}:${crypto.randomUUID()}` },
      body: buildCanonicalLiveEvalCreateRunBody({
        ...input,
        userMessageId,
        clientRunId,
      }),
    }, { signal });
    admittedRunId = readCreatedRunId(created);
    const run = createCanonicalParsedRun(streamResponseStatus);
    const seenCanonicalEventIds = new Set<number>();
    for await (
      const frame of sdk.streamRunEvents({ path: { run_id: admittedRunId } }, { signal })
    ) {
      const eventId = frame.event.event_id;
      if (eventId !== null) {
        if (seenCanonicalEventIds.has(eventId)) continue;
        seenCanonicalEventIds.add(eventId);
      }
      run.responseStatus = streamResponseStatus;
      applyCanonicalParsedEvent(run, normalizeCanonicalRunStreamFrame(frame));
      input.progressReporter.update({
        eventCount: run.events.length,
        lastEventType: run.eventTypes.at(-1) ?? null,
        lastToolCallName: run.toolStarts.at(-1) ?? null,
        toolStarts: [...run.toolStarts],
        textLength: run.text.length,
      });
      terminal = isTerminalCanonicalEvent(run);
    }
    run.text = run.text.trim();
    const errorEvent = run.events.find((event) =>
      getStringField(event, "type") === agUiSseEventTypes.runError
    );
    run.runError = errorEvent && typeof errorEvent.message === "string" ? errorEvent.message : null;
    run.responseStatus = streamResponseStatus;
    terminal = terminal || isTerminalCanonicalEvent(run);
    if (!terminal) {
      run.runError = "Canonical live eval stream ended before terminal RUN_FINISHED/RUN_ERROR";
      await cancelCanonicalLiveEvalRun({
        sdk,
        runId: admittedRunId,
        requestTimeoutMs: input.config.requestTimeoutMs,
      });
      cancelledAfterUnfinishedStream = true;
      throw createEvalValidationError(run.runError);
    }
    return { run, runId: admittedRunId };
  } catch (error) {
    if (admittedRunId && !terminal && !cancelledAfterUnfinishedStream) {
      await cancelCanonicalLiveEvalRun({
        sdk,
        runId: admittedRunId,
        requestTimeoutMs: input.config.requestTimeoutMs,
      });
    }
    throw error;
  }
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
    projectId: input.config.projectId,
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
  const verificationResult = await input.testCase.verify(input.run, input.prepared);
  if (
    verificationResult !== null &&
    (typeof verificationResult !== "string" || verificationResult.trim().length === 0)
  ) {
    throw createEvalValidationError(
      `Live eval verifier for "${input.testCase.id}" must return null or a non-empty failure message`,
    );
  }
  const failure = verificationResult;

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

/** Check whether finished is present. */
export function hasFinished(run: ParsedRun): boolean {
  return run.eventTypes.includes(agUiSseEventTypes.runFinished) && !run.runError;
}

/** Contains skill load helper. */
function readOwnDataField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function readLoadedSkillId(input: unknown): string | null {
  const skillId = readOwnDataField(input, "skillId");
  if (typeof skillId === "string") return skillId;
  const nestedSkillId = readOwnDataField(readOwnDataField(input, "load"), "skillId");
  return typeof nestedSkillId === "string" ? nestedSkillId : null;
}

export function containsSkillLoad(run: ParsedRun, skillId: string): boolean {
  const names = new Map<string, string>();
  const args = new Map<string, string>();
  for (const event of run.events) {
    const id = getStringField(event, "toolCallId");
    if (!id) continue;
    const type = getStringField(event, "type");
    if (type === agUiSseEventTypes.toolCallStart) {
      const name = getStringField(event, "toolCallName");
      if (name) names.set(id, name);
    } else if (type === agUiSseEventTypes.toolCallArgs) {
      args.set(id, `${args.get(id) ?? ""}${getStringField(event, "delta") ?? ""}`);
    }
  }
  for (const [id, name] of names) {
    if (name !== "load_skill" && name !== "veryfront__load_skill") continue;
    try {
      if (readLoadedSkillId(JSON.parse(args.get(id) ?? "")) === skillId) return true;
    } catch { /* An incomplete argument stream is not a completed skill load. */ }
  }
  return false;
}

/** Count step started events helper. */
export function countStepStartedEvents(run: ParsedRun): number {
  return run.eventTypes.filter((eventType) => eventType === agUiSseEventTypes.stepStarted).length;
}

/** Create live eval case support. */
export function createLiveEvalCaseSupport(config: LiveEvalRunnerConfig): {
  runEval: (testCase: LiveEvalCase, runtime: LiveEvalRuntime) => Promise<LiveEvalResultRecord>;
  verifyFileExists: (input: FileCheckInput) => Promise<string | null>;
  withJudge: (
    structuralVerify: (run: ParsedRun) => string | null,
    judgeInput: LiveEvalJudgeInput,
  ) => (run: ParsedRun) => Promise<string | null>;
  judgeLlm: (input: LiveEvalJudgeRequest) => Promise<LiveEvalJudgeResult>;
} {
  assertLiveEvalRunnerConfig(config);
  const fetchImpl = resolveFetch(config);
  const log = config.log ?? console.log;
  const { judgeLlm, withJudge } = createLiveEvalJudgeSupport(config);

  async function verifyFileExists(input: FileCheckInput): Promise<string | null> {
    if (!config.projectId) {
      return `${
        input.description ?? input.filePath
      }: project file verification requires project scope`;
    }
    if (!config.readProjectFile) {
      return `${input.description ?? input.filePath}: project file reader is not configured`;
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

    let prepared: PreparedLiveEvalInput | null = null;
    let sidecarCleanup: (() => Promise<void>) | undefined;
    let progressReporter: LiveEvalProgressReporter | null = null;
    let resultContext = createLiveEvalResultContext({
      testCase,
      runtime,
      startedAt,
      conversationId: null,
      artifactPaths: [],
    });
    let result: LiveEvalResultRecord;

    try {
      prepared = testCase.prepare
        ? await testCase.prepare({
          apiUrl: config.apiUrl,
          authToken: config.authToken,
          projectId: config.projectId,
        })
        : null;
      const preparedConversationId = extractPreparedConversationId(prepared);
      resultContext = createLiveEvalResultContext({
        testCase,
        runtime,
        startedAt,
        conversationId: preparedConversationId,
        artifactPaths: collectPreparedArtifactPaths(prepared),
      });
      const directBody = preparedConversationId ? null : buildLiveEvalRunBody({
        config,
        testCase,
        prepared,
        conversationId: preparedConversationId,
      });
      const startedSidecarCleanup = prepared?.startSidecar
        ? await prepared.startSidecar()
        : undefined;
      if (
        startedSidecarCleanup !== undefined &&
        typeof startedSidecarCleanup !== "function"
      ) {
        throw createEvalValidationError(
          `Live eval sidecar for "${testCase.id}" must return a cleanup function or undefined`,
        );
      }
      sidecarCleanup = typeof startedSidecarCleanup === "function"
        ? startedSidecarCleanup
        : undefined;
      progressReporter = createLiveEvalProgressReporter({
        caseId: testCase.id,
        startedAt,
        intervalMs: config.progressLogIntervalMs,
        log,
      });

      if (preparedConversationId) {
        const canonical = await runCanonicalConversationLiveEval({
          config,
          fetch: fetchImpl,
          testCase,
          prepared,
          conversationId: preparedConversationId,
          progressReporter,
        });
        log(`[stream] ${runtime}:${testCase.id} canonical run ${canonical.runId}`);
        result = await resolveCompletedLiveEvalRun({
          testCase,
          run: canonical.run,
          prepared,
          context: resultContext,
          runId: canonical.runId,
        });
      } else {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.authToken}`,
          },
          body: JSON.stringify(directBody),
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        });

        log(`[stream] ${runtime}:${testCase.id} HTTP ${response.status}`);

        const run = await parseSseResponse(response, {
          onProgress: progressReporter.update,
        });
        result = await resolveCompletedLiveEvalRun({
          testCase,
          run,
          prepared,
          context: resultContext,
          runId: extractRunId(run) ?? undefined,
        });
      }
    } catch (error) {
      result = createStreamingFailureEvalResult({
        context: resultContext,
        details: stringifyEvalError(error),
        progress: progressReporter?.getSnapshot() ?? createInitialProgressSnapshot(),
      });
    }

    progressReporter?.stop();
    const cleanupFailures: string[] = [];
    const sidecarFailure = await captureLiveEvalCleanupFailure("sidecar", sidecarCleanup);
    if (sidecarFailure) cleanupFailures.push(sidecarFailure);
    const preparedFailure = await captureLiveEvalCleanupFailure(
      "prepared input",
      prepared?.cleanup,
    );
    if (preparedFailure) cleanupFailures.push(preparedFailure);

    return applyLiveEvalCleanupFailures(result, cleanupFailures, startedAt);
  }

  return {
    judgeLlm,
    runEval,
    verifyFileExists,
    withJudge,
  };
}

/** White-box helpers used by live eval runner tests. */
export const liveEvalRunnerInternals = {
  collectPreparedArtifactPaths,
  createFailedRunEvalResult,
  createLiveEvalRunArtifacts,
  createPassedRunEvalResult,
  createStreamingFailureEvalResult,
  extractRunId,
};
