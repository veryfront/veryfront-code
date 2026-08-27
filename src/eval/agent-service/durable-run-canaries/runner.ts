import { defineSchema } from "#veryfront/schemas/index.ts";
import { API_CLIENT_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { isNativeErrorWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { sleep } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  assertCanonicalEvalString,
  assertEvalTimerDuration,
  createEvalValidationError,
  normalizeEvalString,
  stringifyEvalError,
} from "../../validation.ts";

ensureBuiltinSchemaValidator();

const MAX_DURABLE_CANARY_API_ERROR_BODY_BYTES = 4_096;

/** Configuration used by durable run canary API. */
export interface DurableRunCanaryApiConfig {
  apiUrl: string;
  authToken: string;
  agentId: string;
  projectId: string | null;
  branchId?: string | null;
  model?: string | null;
  requestTimeoutMs: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** Input payload for durable run canary create root run. */
export interface DurableRunCanaryCreateRootRunInput {
  conversationId: string;
  runId: string;
}

/** Input payload for durable run canary send user message. */
export interface DurableRunCanarySendUserMessageInput {
  conversationId: string;
  prompt: string;
}

/** Input payload for durable run canary start run. */
export interface DurableRunCanaryStartRunInput extends DurableRunCanaryCreateRootRunInput {
  messageId: string;
  prompt: string;
  userMessageId: string;
}

/** Zod schema for get durable run canary message. */
export const getDurableRunCanaryMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    status: v.string().optional(),
    parts: v.array(v.object({ type: v.string() }).passthrough()).default([]),
  }).passthrough()
);

/** Message shape for durable run canary. */
export type DurableRunCanaryMessage = InferSchema<
  ReturnType<typeof getDurableRunCanaryMessageSchema>
>;

/** Public API contract for durable run canary run summary. */
export interface DurableRunCanaryRunSummary {
  runId: string;
  conversationId: string;
  messageId: string;
  agentId: string;
  status: string;
  latestEventId: number;
  latestExternalEventSequence: number | null;
  waitingToolCallId: string | null;
  waitingToolName: string | null;
  terminalErrorCode: string | null;
  terminalErrorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

const getSnakeRunSummarySchema = defineSchema((v) =>
  v.object({
    run_id: v.string(),
    conversation_id: v.string().uuid(),
    message_id: v.string().uuid(),
    agent_id: v.string(),
    status: v.string(),
    latest_event_id: v.number().int().nonnegative(),
    latest_external_event_sequence: v.number().int().nonnegative().optional(),
    waiting_tool_call_id: v.string().nullable().optional(),
    waiting_tool_name: v.string().nullable().optional(),
    terminal_error_code: v.string().nullable().optional(),
    terminal_error_message: v.string().nullable().optional(),
    started_at: v.string().nullable().optional(),
    finished_at: v.string().nullable().optional(),
  }).passthrough()
);

const getCamelRunSummarySchema = defineSchema((v) =>
  v.object({
    runId: v.string(),
    conversationId: v.string().uuid(),
    messageId: v.string().uuid(),
    agentId: v.string(),
    status: v.string(),
    latestEventId: v.number().int().nonnegative(),
    latestExternalEventSequence: v.number().int().nonnegative().optional(),
    waitingToolCallId: v.string().nullable().optional(),
    waitingToolName: v.string().nullable().optional(),
    terminalErrorCode: v.string().nullable().optional(),
    terminalErrorMessage: v.string().nullable().optional(),
    startedAt: v.string().nullable().optional(),
    finishedAt: v.string().nullable().optional(),
  }).passthrough()
);

const getDurableRunCanaryMessageListSchema = defineSchema((v) =>
  v.object({
    data: v.array(getDurableRunCanaryMessageSchema()),
  })
);

/** Parses durable run canary run summary. */
export function parseDurableRunCanaryRunSummary(value: unknown): DurableRunCanaryRunSummary {
  const snake = getSnakeRunSummarySchema().safeParse(value);
  if (snake.success) {
    return {
      runId: snake.data.run_id,
      conversationId: snake.data.conversation_id,
      messageId: snake.data.message_id,
      agentId: snake.data.agent_id,
      status: snake.data.status,
      latestEventId: snake.data.latest_event_id,
      latestExternalEventSequence: snake.data.latest_external_event_sequence ?? null,
      waitingToolCallId: snake.data.waiting_tool_call_id ?? null,
      waitingToolName: snake.data.waiting_tool_name ?? null,
      terminalErrorCode: snake.data.terminal_error_code ?? null,
      terminalErrorMessage: snake.data.terminal_error_message ?? null,
      startedAt: snake.data.started_at ?? null,
      finishedAt: snake.data.finished_at ?? null,
    };
  }

  const camel = getCamelRunSummarySchema().parse(value);
  return {
    runId: camel.runId,
    conversationId: camel.conversationId,
    messageId: camel.messageId,
    agentId: camel.agentId,
    status: camel.status,
    latestEventId: camel.latestEventId,
    latestExternalEventSequence: camel.latestExternalEventSequence ?? null,
    waitingToolCallId: camel.waitingToolCallId ?? null,
    waitingToolName: camel.waitingToolName ?? null,
    terminalErrorCode: camel.terminalErrorCode ?? null,
    terminalErrorMessage: camel.terminalErrorMessage ?? null,
    startedAt: camel.startedAt ?? null,
    finishedAt: camel.finishedAt ?? null,
  };
}

function createJsonHeaders(config: DurableRunCanaryApiConfig, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (!result.has("Content-Type")) {
    result.set("Content-Type", "application/json");
  }
  result.set(
    "Authorization",
    `Bearer ${normalizeEvalString(config.authToken, "Durable canary auth token")}`,
  );
  return result;
}

function createFetch(config: DurableRunCanaryApiConfig) {
  return config.fetch ?? fetch;
}

function createApiUrl(config: DurableRunCanaryApiConfig, path: string): URL {
  const apiUrl = normalizeEvalString(config.apiUrl, "Durable canary API URL");
  const baseHref = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relativePath, baseHref);
}

function encodePathSegment(value: string, label: string): string {
  return encodeURIComponent(normalizeEvalString(value, label));
}

function assertDurableRunCanaryApiConfig(config: DurableRunCanaryApiConfig): void {
  assertCanonicalEvalString(config.apiUrl, "Durable canary API URL");
  if (!URL.canParse(config.apiUrl)) {
    throw new TypeError("Durable canary API URL must be a valid absolute URL");
  }
  assertCanonicalEvalString(config.authToken, "Durable canary auth token");
  assertCanonicalEvalString(config.agentId, "Durable canary agent id");
  if (config.projectId !== null) {
    assertCanonicalEvalString(config.projectId, "Durable canary project id");
  }
  if (config.branchId !== undefined && config.branchId !== null) {
    assertCanonicalEvalString(config.branchId, "Durable canary branch id");
  }
  if (config.fetch !== undefined && typeof config.fetch !== "function") {
    throw new TypeError("Durable canary fetch must be a function");
  }
  assertEvalTimerDuration(config.requestTimeoutMs, "Durable canary requestTimeoutMs", {
    min: 1,
  });
}

async function getBoundedApiErrorBody(response: Response): Promise<string> {
  const { text, truncated } = await readResponseTextPrefix(
    response,
    MAX_DURABLE_CANARY_API_ERROR_BODY_BYTES,
  );
  return truncated ? `${text}…[truncated]` : text;
}

function buildCreateRootRunTargetFields(config: DurableRunCanaryApiConfig) {
  if (!config.projectId) {
    return {};
  }

  if (config.branchId) {
    return {
      source_target_kind: "preview_branch",
      runtime_target_kind: "preview_branch",
      source_target_branch_id: config.branchId,
      runtime_target_branch_id: config.branchId,
    } as const;
  }

  return {
    source_target_kind: "project",
    runtime_target_kind: "main_branch",
    runtime_target_branch_id: null,
  } as const;
}

function buildCreateRootRunBody(
  config: DurableRunCanaryApiConfig,
  input: DurableRunCanaryCreateRootRunInput,
) {
  const conversationId = normalizeEvalString(
    input.conversationId,
    "Durable canary conversation id",
  );
  const runId = normalizeEvalString(input.runId, "Durable canary run id");
  return {
    kind: "agent",
    owner: {
      kind: "conversation",
      id: conversationId,
    },
    public_id: runId,
    request: {
      mode: "agent",
      agent_id: config.agentId,
      initial_status: "pending",
      ...buildCreateRootRunTargetFields(config),
    },
  };
}

function buildStartRunBody(
  config: DurableRunCanaryApiConfig,
  input: DurableRunCanaryStartRunInput,
) {
  const conversationId = normalizeEvalString(
    input.conversationId,
    "Durable canary conversation id",
  );
  const runId = normalizeEvalString(input.runId, "Durable canary run id");
  const messageId = normalizeEvalString(input.messageId, "Durable canary message id");
  const userMessageId = normalizeEvalString(
    input.userMessageId,
    "Durable canary user message id",
  );
  const prompt = normalizeEvalString(input.prompt, "Durable canary prompt");
  return {
    kind: "agent",
    owner: {
      kind: "conversation",
      id: conversationId,
    },
    public_id: runId,
    request: {
      mode: "agent",
      agent_id: config.agentId,
      input: {
        messages: [
          {
            id: userMessageId,
            role: "user",
            parts: [{ type: "text", text: prompt }],
          },
        ],
        context: {
          conversation_id: conversationId,
          project_id: config.projectId,
          branch_id: config.branchId ?? null,
        },
        durable_root_run: {
          run_id: runId,
          message_id: messageId,
        },
        forwarded_props: {
          ...(config.model ? { model: config.model } : {}),
          veryfront: {
            client: {
              id: "veryfront-studio",
              type: "web",
              platform: "durable-canary",
            },
          },
        },
      },
    },
  };
}

/** Public API contract for durable run canary API client. */
export interface DurableRunCanaryApiClient {
  createDurableRootRun: (input: DurableRunCanaryCreateRootRunInput) => Promise<void>;
  getRunSummary: (input: DurableRunCanaryCreateRootRunInput) => Promise<DurableRunCanaryRunSummary>;
  listMessagesForCanary: (input: { conversationId: string }) => Promise<DurableRunCanaryMessage[]>;
  sendUserMessageForCanary: (
    input: DurableRunCanarySendUserMessageInput,
  ) => Promise<DurableRunCanaryMessage>;
  startDurableRun: (input: DurableRunCanaryStartRunInput) => Promise<void>;
}

/** Create durable run canary API client. */
export function createDurableRunCanaryApiClient(
  config: DurableRunCanaryApiConfig,
): DurableRunCanaryApiClient {
  assertDurableRunCanaryApiConfig(config);
  const request = createFetch(config);

  async function requestApi(path: string, init?: RequestInit): Promise<Response> {
    const response = await request(createApiUrl(config, path), {
      ...init,
      headers: createJsonHeaders(config, init?.headers),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw API_CLIENT_ERROR.create({
        detail: `API ${
          init?.method ?? "GET"
        } ${path} failed: ${response.status} ${await getBoundedApiErrorBody(response)}`,
        status: response.status,
      });
    }
    return response;
  }

  async function apiFetch<T>(
    path: string,
    init: RequestInit | undefined,
    parse: (value: unknown) => T,
  ): Promise<T>;
  async function apiFetch(path: string, init?: RequestInit): Promise<unknown>;
  async function apiFetch<T>(
    path: string,
    init?: RequestInit,
    parse?: (value: unknown) => T,
  ): Promise<T | unknown> {
    const response = await requestApi(path, init);
    const payload: unknown = await response.json();
    return parse ? parse(payload) : payload;
  }

  async function sendUserMessageForCanary(input: DurableRunCanarySendUserMessageInput) {
    const conversationId = encodePathSegment(
      input.conversationId,
      "Durable canary conversation id",
    );
    return apiFetch(
      `/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          role: "user",
          parts: [{
            type: "text",
            text: normalizeEvalString(input.prompt, "Durable canary prompt"),
          }],
        }),
      },
      (value) => getDurableRunCanaryMessageSchema().parse(value),
    );
  }

  async function createDurableRootRun(input: DurableRunCanaryCreateRootRunInput): Promise<void> {
    await requestApi("/runs", {
      method: "POST",
      body: JSON.stringify(buildCreateRootRunBody(config, input)),
    });
  }

  async function startDurableRun(input: DurableRunCanaryStartRunInput): Promise<void> {
    await requestApi("/runs", {
      method: "POST",
      body: JSON.stringify(buildStartRunBody(config, input)),
    });
  }

  async function getRunSummary(input: DurableRunCanaryCreateRootRunInput) {
    const conversationId = encodePathSegment(
      input.conversationId,
      "Durable canary conversation id",
    );
    const runId = encodePathSegment(input.runId, "Durable canary run id");
    const response = await apiFetch(`/conversations/${conversationId}/runs/${runId}`);
    return parseDurableRunCanaryRunSummary(response);
  }

  async function listMessagesForCanary(input: { conversationId: string }) {
    const conversationId = encodePathSegment(
      input.conversationId,
      "Durable canary conversation id",
    );
    const payload = await apiFetch(
      `/conversations/${conversationId}/messages?limit=100`,
      undefined,
      (value) => getDurableRunCanaryMessageListSchema().parse(value),
    );

    return payload.data;
  }

  return {
    createDurableRootRun,
    getRunSummary,
    listMessagesForCanary,
    sendUserMessageForCanary,
    startDurableRun,
  };
}

/** Execution metadata retained for each durable run canary prompt. */
export interface DurableRunCanaryExecution {
  runId: string;
  run: DurableRunCanaryRunSummary;
}

/** Result returned from durable run canary. */
export interface DurableRunCanaryResult {
  id: string;
  label: string;
  status: "pass" | "fail";
  details: string;
  durationMs: number;
  conversationId: string;
  runId: string;
  runIds: string[];
  artifactPaths?: string[];
}

/** Public API contract for durable run canary prepared case. */
export interface DurableRunCanaryPreparedCase {
  artifactPaths?: string[] | ((runId: string) => string[]);
  cleanup: (input?: { runId: string }) => Promise<void>;
  conversationId: string;
  followUpPrompt?: string;
  prompt: string;
  startSidecar?: () => Promise<(() => Promise<void>) | void>;
  title: string;
  validate: (input: {
    messages: DurableRunCanaryMessage[];
    run: DurableRunCanaryRunSummary;
    executions: DurableRunCanaryExecution[];
  }) => Promise<void> | void;
}

/** Public API contract for durable run canary case. */
export interface DurableRunCanaryCase {
  id: string;
  label: string;
  prepare: () => Promise<DurableRunCanaryPreparedCase>;
}

/** Configuration used by durable run canary runner. */
export interface DurableRunCanaryRunnerConfig extends DurableRunCanaryApiConfig {
  keepSuccessfulEvidence: boolean;
}

interface RunSummaryLocator {
  conversationId: string;
  runId: string;
}

interface WaitForRunInput extends RunSummaryLocator {
  getRunSummary: (input: RunSummaryLocator) => Promise<DurableRunCanaryRunSummary>;
  requestTimeoutMs: number;
}

interface ExecuteDurableRunPromptInput {
  conversationId: string;
  onRunId: (runId: string) => void;
  createdRunIds: string[];
  prompt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectChildConversationIdsFromValue(
  value: unknown,
  childConversationIds: Set<string>,
  depth = 0,
): void {
  if (depth > 8) {
    return;
  }

  if (typeof value === "string") {
    try {
      collectChildConversationIdsFromValue(JSON.parse(value), childConversationIds, depth + 1);
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChildConversationIdsFromValue(entry, childConversationIds, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const key of ["childConversationId", "child_conversation_id"]) {
    const childConversationId = value[key];
    if (typeof childConversationId === "string" && UUID_PATTERN.test(childConversationId)) {
      childConversationIds.add(childConversationId);
    }
  }

  for (const nestedValue of Object.values(value)) {
    collectChildConversationIdsFromValue(nestedValue, childConversationIds, depth + 1);
  }
}

function collectReferencedChildConversationIds(messages: DurableRunCanaryMessage[]): string[] {
  const childConversationIds = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isRecord(part) || (part.type !== "tool_result" && part.type !== "tool-result")) {
        continue;
      }

      collectChildConversationIdsFromValue(part.output, childConversationIds);
    }
  }

  return [...childConversationIds];
}

function isTerminalRunStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function assertCompletedSetupRunBeforeFollowUp(run: DurableRunCanaryRunSummary): void {
  if (run.status === "completed") {
    return;
  }

  const reason = run.terminalErrorMessage ?? run.terminalErrorCode ?? `status ${run.status}`;
  throw TIMEOUT_ERROR.create({
    detail: `Setup durable run did not complete before follow-up: ${reason}`,
  });
}

function createDurableRunCanaryRunId(): string {
  return `run_${crypto.randomUUID()}`;
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  try {
    if (
      ("status" in error && error.status === 404) ||
      ("statusCode" in error && error.statusCode === 404)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  if (!isNativeErrorWithoutHooks(error)) return false;

  try {
    const message = Object.getOwnPropertyDescriptor(error, "message");
    return message !== undefined && "value" in message &&
      typeof message.value === "string" && /\b404\b/.test(message.value);
  } catch {
    return false;
  }
}

async function getRunSummaryBeforeDeadline(
  input: WaitForRunInput,
  deadline: number,
  timeoutDetail: string,
): Promise<DurableRunCanaryRunSummary> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw TIMEOUT_ERROR.create({ detail: timeoutDetail });
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(TIMEOUT_ERROR.create({ detail: timeoutDetail }));
    }, remainingMs);
  });
  try {
    return await Promise.race([input.getRunSummary(input), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function waitForRunSummaryVisibility(
  input: WaitForRunInput,
): Promise<DurableRunCanaryRunSummary> {
  const deadline = Date.now() + input.requestTimeoutMs;
  const timeoutDetail = `Run ${input.runId} did not become visible in time`;

  while (Date.now() < deadline) {
    try {
      return await getRunSummaryBeforeDeadline(input, deadline, timeoutDetail);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
  }

  throw TIMEOUT_ERROR.create({ detail: timeoutDetail });
}

async function waitForTerminalRun(
  input: WaitForRunInput,
): Promise<DurableRunCanaryRunSummary> {
  const deadline = Date.now() + input.requestTimeoutMs;
  const timeoutDetail = `Timed out waiting for run ${input.runId} to reach a terminal state`;

  while (Date.now() < deadline) {
    const run = await getRunSummaryBeforeDeadline(input, deadline, timeoutDetail);
    if (isTerminalRunStatus(run.status)) {
      return run;
    }

    await sleep(Math.min(1_500, Math.max(0, deadline - Date.now())));
  }

  throw TIMEOUT_ERROR.create({ detail: timeoutDetail });
}

/** Create durable run canary runner. */
export function createDurableRunCanaryRunner(
  config: DurableRunCanaryRunnerConfig,
  apiClient: DurableRunCanaryApiClient = createDurableRunCanaryApiClient(config),
) {
  assertDurableRunCanaryApiConfig(config);
  const getRunSummary = apiClient.getRunSummary;

  async function listMessagesWithReferencedChildren(
    conversationId: string,
  ): Promise<DurableRunCanaryMessage[]> {
    const messages = await apiClient.listMessagesForCanary({ conversationId });
    const childConversationIds = collectReferencedChildConversationIds(messages);
    const childMessages = await Promise.all(
      childConversationIds.map((childConversationId) =>
        apiClient.listMessagesForCanary({ conversationId: childConversationId })
      ),
    );

    return [...messages, ...childMessages.flat()];
  }

  async function executeDurableRunPrompt(
    input: ExecuteDurableRunPromptInput,
  ): Promise<DurableRunCanaryExecution> {
    const userMessage = await apiClient.sendUserMessageForCanary({
      conversationId: input.conversationId,
      prompt: input.prompt,
    });
    const currentRunId = createDurableRunCanaryRunId();
    input.onRunId(currentRunId);

    await apiClient.createDurableRootRun({
      conversationId: input.conversationId,
      runId: currentRunId,
    });
    input.createdRunIds.push(currentRunId);
    const visibleRun = await waitForRunSummaryVisibility({
      conversationId: input.conversationId,
      getRunSummary,
      requestTimeoutMs: config.requestTimeoutMs,
      runId: currentRunId,
    });

    await apiClient.startDurableRun({
      conversationId: input.conversationId,
      messageId: visibleRun.messageId,
      prompt: input.prompt,
      runId: currentRunId,
      userMessageId: userMessage.id,
    });

    const terminalRun = await waitForTerminalRun({
      conversationId: input.conversationId,
      getRunSummary,
      requestTimeoutMs: config.requestTimeoutMs,
      runId: currentRunId,
    });

    return {
      run: terminalRun,
      runId: currentRunId,
    };
  }

  async function runCase(testCase: DurableRunCanaryCase): Promise<DurableRunCanaryResult> {
    const startedAt = Date.now();
    let prepared: DurableRunCanaryPreparedCase | null = null;
    let runId = "unknown";
    const runIds: string[] = [];
    const executions: DurableRunCanaryExecution[] = [];
    let stopSidecar: (() => Promise<void>) | undefined;
    let result: DurableRunCanaryResult;

    try {
      prepared = await testCase.prepare();
      const startedSidecarCleanup = await prepared.startSidecar?.();
      if (
        startedSidecarCleanup !== undefined &&
        typeof startedSidecarCleanup !== "function"
      ) {
        throw createEvalValidationError(
          `Durable canary sidecar for "${testCase.id}" must return a cleanup function or undefined`,
        );
      }
      stopSidecar = typeof startedSidecarCleanup === "function" ? startedSidecarCleanup : undefined;
      const initialRun = await executeDurableRunPrompt({
        conversationId: prepared.conversationId,
        createdRunIds: runIds,
        onRunId: (currentRunId) => {
          runId = currentRunId;
        },
        prompt: prepared.prompt,
      });
      executions.push(initialRun);
      runId = initialRun.runId;
      if (prepared.followUpPrompt) {
        assertCompletedSetupRunBeforeFollowUp(initialRun.run);
      }
      let terminalRun = initialRun;
      if (prepared.followUpPrompt) {
        terminalRun = await executeDurableRunPrompt({
          conversationId: prepared.conversationId,
          createdRunIds: runIds,
          onRunId: (currentRunId) => {
            runId = currentRunId;
          },
          prompt: prepared.followUpPrompt,
        });
        executions.push(terminalRun);
      }
      runId = terminalRun.runId;
      const messages = await listMessagesWithReferencedChildren(prepared.conversationId);

      await prepared.validate({
        executions,
        messages,
        run: terminalRun.run,
      });

      const artifactPaths = typeof prepared.artifactPaths === "function"
        ? prepared.artifactPaths(runId)
        : prepared.artifactPaths;

      result = {
        id: testCase.id,
        label: testCase.label,
        status: "pass",
        details: "OK",
        durationMs: Date.now() - startedAt,
        conversationId: prepared.conversationId,
        runId,
        runIds,
        ...(artifactPaths?.length ? { artifactPaths } : {}),
      };
    } catch (error) {
      let artifactPaths: string[] | undefined;
      try {
        artifactPaths = typeof prepared?.artifactPaths === "function"
          ? prepared.artifactPaths(runId)
          : prepared?.artifactPaths;
      } catch {
        artifactPaths = undefined;
      }

      result = {
        id: testCase.id,
        label: testCase.label,
        status: "fail",
        details: stringifyEvalError(error),
        durationMs: Date.now() - startedAt,
        conversationId: prepared?.conversationId ?? "unknown",
        runId,
        runIds,
        ...(artifactPaths?.length ? { artifactPaths } : {}),
      };
    }

    if (stopSidecar) {
      try {
        await stopSidecar();
      } catch (error) {
        result = {
          ...result,
          status: "fail",
          details: `${result.details} Sidecar cleanup failed: ${stringifyEvalError(error)}`,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    if (prepared && (result.status === "fail" || !config.keepSuccessfulEvidence)) {
      try {
        await prepared.cleanup({ runId });
      } catch (error) {
        result = {
          ...result,
          status: "fail",
          details: `${result.details} Prepared input cleanup failed: ${stringifyEvalError(error)}`,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    return result;
  }

  return {
    runCase,
  };
}

/** White-box helpers used by durable run canary tests. */
export const durableRunCanaryRunnerInternals = {
  collectReferencedChildConversationIds,
  isTerminalRunStatus,
};
