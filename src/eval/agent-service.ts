import {
  agUiSseEventTypes,
  type AgUiSseProgressSnapshot,
  getAgUiSseStringField,
  mergeToolInputDelta,
  parseAgentServiceConfig,
  parseAgUiSseResponse,
  type ParseAgUiSseResponseOptions,
} from "#veryfront/agent";
import type {
  EvalAgentAdapter,
  EvalAgentAdapterContext,
  EvalAgentAdapterResult,
  EvalToolCall,
  EvalUsage,
} from "./types.ts";
import {
  assertCanonicalEvalString,
  assertEvalTimerDuration,
  assertFiniteEvalNumber,
  createEvalValidationError,
  normalizeEvalString,
  normalizeEvalStringList,
  stringifyEvalError,
} from "./validation.ts";
import { trustedLocalEvalFetchAgentId } from "./agent-service/trusted-fetch.ts";

export * from "./agent-service/live-evals/index.ts";
export * from "./agent-service/durable-run-canaries/index.ts";

/** Default local AG-UI endpoint used by agent-service evals. */
export const DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT = "http://127.0.0.1:3001/api/ag-ui";

/** Environment input accepted by agent-service eval helpers. */
export type AgentServiceEvalEnvironmentInput = Record<string, string | number | undefined>;

/** Resolved environment values for live agent-service evals. */
export interface AgentServiceEvalEnvironment {
  endpoint: string;
  authToken: string;
  apiUrl: string;
  projectId?: string;
  projectSlug?: string;
  branchId?: string;
  model?: string;
}

/** Preflight result for a live agent-service eval environment. */
export interface AgentServiceEvalEnvironmentPreflightResult {
  ok: boolean;
  resolvedApiUrl: string;
  messages: string[];
}

/** Veryfront forwarded props included in an AG-UI eval request. */
export interface AgentServiceEvalForwardedProps {
  agentId?: string;
  projectId?: string;
  conversationId?: string;
  branchId?: string;
  model?: string;
  runtimeOverrides?: {
    allowedTools?: string[];
    maxSteps?: number;
  };
}

/** Input accepted by `buildAgentServiceEvalRequestBody`. */
export interface BuildAgentServiceEvalRequestBodyInput {
  exampleId: string;
  input: unknown;
  metadata?: Record<string, unknown>;
  agentId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  branchId?: string | null;
  model?: string | null;
  allowedTools?: string[];
  forceRuntimeOverrides?: boolean;
  maxSteps?: number;
}

/** AG-UI request body sent to an agent-service endpoint. */
export interface AgentServiceEvalRequestBody {
  threadId: string;
  runId: string;
  state: Record<string, unknown>;
  tools: [];
  context: [];
  forwardedProps?: {
    veryfront: AgentServiceEvalForwardedProps;
  };
  messages: Array<{
    id: string;
    role: "user";
    parts: Array<{
      type: "text";
      text: string;
    }>;
  }>;
}

/** Configuration for the live agent-service eval adapter. */
export interface AgentServiceEvalAdapterConfig {
  endpoint?: string;
  authToken: string;
  agentId?: string | null;
  projectId?: string | null;
  projectSlug?: string | null;
  conversationId?: string | null;
  releaseId?: string | null;
  contentSourceId?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  environment?: string | null;
  environmentId?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  model?: string | null;
  allowedTools?: string[];
  forceRuntimeOverrides?: boolean;
  maxSteps?: number;
  requestTimeoutMs?: number;
  progressThrottleMs?: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  onProgress?: (snapshot: AgUiSseProgressSnapshot, context: EvalAgentAdapterContext) => void;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTrimmedEnvironmentString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveAgentServiceEvalApiUrl(env: AgentServiceEvalEnvironmentInput): string {
  const explicitApiUrl = readTrimmedEnvironmentString(env.VERYFRONT_API_URL);
  if (explicitApiUrl !== undefined) {
    return explicitApiUrl;
  }
  return parseAgentServiceConfig({
    ...env,
    VERYFRONT_API_URL: undefined,
  }).VERYFRONT_API_URL;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function readUsageCostSource(value: unknown): EvalUsage["costSource"] | undefined {
  return value === "gateway" || value === "missing" || value === "partial" ? value : undefined;
}

function readUsageCaptureStatus(value: unknown): EvalUsage["usageCaptureStatus"] | undefined {
  return value === "complete" || value === "missing" || value === "partial" ? value : undefined;
}

function readUsageBillingMode(value: unknown): EvalUsage["billingMode"] | undefined {
  return value === "direct" || value === "deferred" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyPromptInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (isRecord(input)) {
    const prompt = readString(input.prompt) ?? readString(input.message) ?? readString(input.input);
    if (prompt) return prompt;
  }
  try {
    return JSON.stringify(input) ?? String(input);
  } catch (error) {
    throw createEvalValidationError(
      `Agent-service eval input must be JSON-serializable: ${stringifyEvalError(error)}`,
    );
  }
}

function getInputMetadata(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || !isRecord(input.metadata)) return {};
  return { ...input.metadata };
}

/**
 * Resolve a request scope override.
 *
 * Only an omitted (`undefined`) caller value falls back to the eval example's
 * own data. An explicit `null` is the caller disabling that scope, so untrusted
 * example data must not be able to reintroduce it.
 */
function resolveScopeOverride(
  configured: string | null | undefined,
  fromExample: unknown,
): string | null {
  if (configured !== undefined) return configured;
  return readString(fromExample) ?? null;
}

function getRequestOverrides(input: BuildAgentServiceEvalRequestBodyInput) {
  const record = isRecord(input.input) ? input.input : {};
  return {
    agentId: input.agentId ?? null,
    projectId: resolveScopeOverride(input.projectId, record.projectId),
    conversationId: resolveScopeOverride(input.conversationId, record.conversationId),
    branchId: resolveScopeOverride(input.branchId, record.branchId),
    model: resolveScopeOverride(input.model, record.model),
    allowedTools: input.allowedTools ?? readStringArray(record.allowedTools),
    forceRuntimeOverrides: input.forceRuntimeOverrides ?? record.forceRuntimeOverrides === true,
    maxSteps: input.maxSteps ?? readFiniteNumber(record.maxSteps),
  };
}

function createVeryfrontForwardedProps(
  input: BuildAgentServiceEvalRequestBodyInput,
): AgentServiceEvalForwardedProps | null {
  const overrides = getRequestOverrides(input);
  const allowedTools = overrides.allowedTools === undefined
    ? undefined
    : normalizeEvalStringList(overrides.allowedTools, "Agent-service eval allowedTools");
  if (overrides.maxSteps !== undefined) {
    assertFiniteEvalNumber(overrides.maxSteps, "Agent-service eval maxSteps", {
      integer: true,
      min: 1,
    });
  }
  const veryfront: AgentServiceEvalForwardedProps = {};

  if (overrides.agentId !== null) {
    veryfront.agentId = normalizeEvalString(overrides.agentId, "Agent-service eval agentId");
  }
  if (overrides.projectId !== null) {
    veryfront.projectId = normalizeEvalString(overrides.projectId, "Agent-service eval projectId");
  }
  if (overrides.conversationId !== null) {
    veryfront.conversationId = normalizeEvalString(
      overrides.conversationId,
      "Agent-service eval conversationId",
    );
  }
  if (overrides.branchId !== null) {
    veryfront.branchId = normalizeEvalString(overrides.branchId, "Agent-service eval branchId");
  }
  if (overrides.model !== null) {
    veryfront.model = normalizeEvalString(overrides.model, "Agent-service eval model");
  }

  const shouldForwardRuntimeOverrides = allowedTools !== undefined ||
    overrides.forceRuntimeOverrides ||
    overrides.maxSteps !== undefined;
  if (shouldForwardRuntimeOverrides) {
    veryfront.runtimeOverrides = {
      ...(allowedTools !== undefined
        ? { allowedTools }
        : overrides.forceRuntimeOverrides
        ? { allowedTools: [] }
        : {}),
      ...(overrides.maxSteps !== undefined ? { maxSteps: overrides.maxSteps } : {}),
    };
  }

  return Object.keys(veryfront).length > 0 ? veryfront : null;
}

function createHeaders(config: AgentServiceEvalAdapterConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.authToken}`,
    "x-token": config.authToken,
    ...(config.projectId ? { "x-project-id": config.projectId } : {}),
    ...(config.projectSlug ? { "x-project-slug": config.projectSlug } : {}),
    ...(config.releaseId ? { "x-release-id": config.releaseId } : {}),
    ...(config.contentSourceId ? { "x-content-source-id": config.contentSourceId } : {}),
    ...(config.branchId ? { "x-branch-id": config.branchId } : {}),
    ...(config.branchName ? { "x-branch-name": config.branchName } : {}),
    ...(config.environment ? { "x-environment": config.environment } : {}),
    ...(config.environmentId ? { "x-environment-id": config.environmentId } : {}),
    ...(config.forwardedHost ? { "x-forwarded-host": config.forwardedHost } : {}),
    ...(config.forwardedProto ? { "x-forwarded-proto": config.forwardedProto } : {}),
  };
}

function getNow(config: Pick<AgentServiceEvalAdapterConfig, "now">): number {
  return config.now?.() ?? Date.now();
}

function stringifyError(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (isRecord(value)) {
    const message = readString(value.message) ?? readString(value.error);
    if (message) return message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return stringifyEvalError(value);
  }
}

function getToolResultError(event: Record<string, unknown>): string | undefined {
  return stringifyError(event.result) ?? stringifyError(event.content) ?? "Tool call failed";
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readToolInputDelta(event: Record<string, unknown>): string | undefined {
  return readString(event.delta) ?? readString(event.inputTextDelta) ?? readString(event.argsDelta);
}

function readToolOutput(event: Record<string, unknown>): unknown {
  if (Object.hasOwn(event, "result")) return event.result;
  if (Object.hasOwn(event, "output")) return event.output;
  if (Object.hasOwn(event, "content")) {
    return typeof event.content === "string" ? parseJsonString(event.content) : event.content;
  }
  return undefined;
}

function isDeniedToolResult(event: Record<string, unknown>, error: string | undefined): boolean {
  const status = getAgUiSseStringField(event, "status");
  return status === "denied" || error?.toLowerCase().includes("denied") === true;
}

type PendingToolCall = {
  call: EvalToolCall;
  inputText?: string;
  hasStandardInput?: boolean;
  hasStandardResult?: boolean;
};

function getToolCallEntry(
  toolCalls: Map<string, PendingToolCall>,
  key: string,
  id: string | null | undefined,
  name: string | null | undefined,
): PendingToolCall {
  const existing = toolCalls.get(key);
  if (existing) {
    if (id && !existing.call.id) existing.call.id = id;
    if (name && existing.call.name === "tool") existing.call.name = name;
    return existing;
  }

  const next: PendingToolCall = {
    call: {
      ...(id ? { id } : {}),
      name: name ?? "tool",
      status: "ok",
    },
  };
  toolCalls.set(key, next);
  return next;
}

function applyToolCallStatusEvent(
  toolCalls: Map<string, PendingToolCall>,
  event: Record<string, unknown>,
  index: number,
): boolean {
  if (
    getAgUiSseStringField(event, "type") !== agUiSseEventTypes.custom ||
    getAgUiSseStringField(event, "name") !== "tool-call-status" ||
    !isRecord(event.value)
  ) {
    return false;
  }

  const value = event.value;
  const id = getAgUiSseStringField(value, "toolCallId");
  const name = getAgUiSseStringField(value, "toolCallName");
  if (!id && !name) return true;

  const entry = getToolCallEntry(toolCalls, id ?? `name:${name ?? index}`, id, name);
  if (!entry.hasStandardInput && Object.hasOwn(value, "arguments")) {
    entry.call.input = value.arguments;
  }

  if (!entry.hasStandardResult) {
    if (Object.hasOwn(value, "result")) {
      entry.call.output = value.result;
    } else if (Object.hasOwn(value, "output")) {
      entry.call.output = value.output;
    }

    const status = getAgUiSseStringField(value, "status");
    const error = Object.hasOwn(value, "error") ? stringifyError(value.error) : undefined;
    const failed = value.isError === true || error !== undefined ||
      status === "failed" || status === "error" || status === "cancelled" ||
      status === "canceled" ||
      (typeof value.exitCode === "number" && value.exitCode !== 0);
    if (status === "denied") {
      entry.call.status = "denied";
    } else if (status === "skipped") {
      entry.call.status = "skipped";
    } else if (failed) {
      entry.call.status = "error";
    } else if (status === "completed") {
      entry.call.status = "ok";
    }
    if (failed) entry.call.error = error ?? "Tool call failed";
  }

  return true;
}

function createToolCalls(events: Array<Record<string, unknown>>): EvalToolCall[] {
  const toolCalls = new Map<string, PendingToolCall>();

  for (const [index, event] of events.entries()) {
    const type = getAgUiSseStringField(event, "type");

    if (applyToolCallStatusEvent(toolCalls, event, index)) continue;

    if (type === agUiSseEventTypes.toolCallStart) {
      const name = getAgUiSseStringField(event, "toolCallName");
      if (!name) continue;

      const id = getAgUiSseStringField(event, "toolCallId");
      const key = id ?? `name:${name}`;
      getToolCallEntry(toolCalls, key, id, name);
      continue;
    }

    if (type === agUiSseEventTypes.toolCallArgs) {
      const id = getAgUiSseStringField(event, "toolCallId");
      const toolName = getAgUiSseStringField(event, "toolCallName");
      const key = id ?? (toolName ? `name:${toolName}` : `args:${index}`);
      const entry = getToolCallEntry(toolCalls, key, id, toolName);
      const input = Object.hasOwn(event, "input") ? event.input : undefined;
      if (input !== undefined) {
        entry.hasStandardInput = true;
        entry.inputText = undefined;
        entry.call.input = input;
        continue;
      }

      const delta = readToolInputDelta(event);
      if (delta === undefined) continue;

      if (!entry.hasStandardInput) {
        entry.inputText = "";
        delete entry.call.input;
      }
      entry.hasStandardInput = true;
      entry.inputText = mergeToolInputDelta(entry.inputText ?? "", delta);
      entry.call.input = parseJsonString(entry.inputText);
      continue;
    }

    if (type === agUiSseEventTypes.toolCallEnd) {
      const id = getAgUiSseStringField(event, "toolCallId");
      const toolName = getAgUiSseStringField(event, "toolCallName");
      const key = id ?? (toolName ? `name:${toolName}` : `end:${index}`);
      getToolCallEntry(toolCalls, key, id, toolName);
      continue;
    }

    if (type === agUiSseEventTypes.toolCallResult) {
      const id = getAgUiSseStringField(event, "toolCallId");
      const toolName = getAgUiSseStringField(event, "toolCallName");
      const key = id ?? (toolName ? `name:${toolName}` : `result:${index}`);
      const entry = getToolCallEntry(toolCalls, key, id, toolName);
      const failed = event.isError === true;
      const error = failed ? getToolResultError(event) : undefined;
      const input = Object.hasOwn(event, "input") ? event.input : undefined;
      if (input !== undefined) {
        entry.hasStandardInput = true;
        entry.inputText = undefined;
        entry.call.input = input;
      }
      entry.hasStandardResult = true;
      delete entry.call.output;
      delete entry.call.error;
      if (!failed) {
        const output = readToolOutput(event);
        if (output !== undefined) entry.call.output = output;
      }
      entry.call.status = failed ? isDeniedToolResult(event, error) ? "denied" : "error" : "ok";
      if (error) entry.call.error = error;
    }
  }

  return [...toolCalls.values()].map((entry) => entry.call);
}

function createRunOutput(run: Awaited<ReturnType<typeof parseAgUiSseResponse>>) {
  return {
    text: run.text,
    agUi: {
      responseStatus: run.responseStatus,
      eventTypes: run.eventTypes,
      runError: run.runError,
    },
  };
}

function createUsageFromRecord(record: Record<string, unknown>): EvalUsage | undefined {
  const inputTokens = readNonNegativeNumber(record.inputTokens) ??
    readNonNegativeNumber(record.input_tokens) ??
    readNonNegativeNumber(record.promptTokens);
  const outputTokens = readNonNegativeNumber(record.outputTokens) ??
    readNonNegativeNumber(record.output_tokens) ??
    readNonNegativeNumber(record.completionTokens);
  const totalTokens = readNonNegativeNumber(record.totalTokens) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const billableInputTokens = readNonNegativeNumber(record.billableInputTokens) ??
    readNonNegativeNumber(record.billable_input_tokens);
  const billableOutputTokens = readNonNegativeNumber(record.billableOutputTokens) ??
    readNonNegativeNumber(record.billable_output_tokens);
  const cachedInputTokens = readNonNegativeNumber(record.cachedInputTokens) ??
    readNonNegativeNumber(record.cached_input_tokens);
  const cacheCreationInputTokens = readNonNegativeNumber(record.cacheCreationInputTokens) ??
    readNonNegativeNumber(record.cacheCreationTokens) ??
    readNonNegativeNumber(record.cache_creation_input_tokens);
  const cacheReadInputTokens = readNonNegativeNumber(record.cacheReadInputTokens) ??
    readNonNegativeNumber(record.cacheReadTokens) ??
    readNonNegativeNumber(record.cache_read_input_tokens);
  const reasoningTokens = readNonNegativeNumber(record.reasoningTokens) ??
    readNonNegativeNumber(record.reasoning_output_tokens) ??
    readNonNegativeNumber(record.reasoning_tokens);
  const providerInputCostUsd = readNonNegativeNumber(record.providerInputCostUsd) ??
    readNonNegativeNumber(record.provider_input_cost_usd);
  const providerOutputCostUsd = readNonNegativeNumber(record.providerOutputCostUsd) ??
    readNonNegativeNumber(record.provider_output_cost_usd);
  const providerCostUsd = readNonNegativeNumber(record.providerCostUsd) ??
    readNonNegativeNumber(record.provider_cost_usd);
  const veryfrontInputChargeUsd = readNonNegativeNumber(record.veryfrontInputChargeUsd) ??
    readNonNegativeNumber(record.veryfront_input_charge_usd);
  const veryfrontOutputChargeUsd = readNonNegativeNumber(record.veryfrontOutputChargeUsd) ??
    readNonNegativeNumber(record.veryfront_output_charge_usd);
  const veryfrontChargeUsd = readNonNegativeNumber(record.veryfrontChargeUsd) ??
    readNonNegativeNumber(record.veryfront_charge_usd);
  const veryfrontBilledUsd = readNonNegativeNumber(record.veryfrontBilledUsd) ??
    readNonNegativeNumber(record.veryfront_billed_usd);
  const costCredits = readNonNegativeNumber(record.costCredits) ??
    readNonNegativeNumber(record.cost_credits);
  const costUsd = readNonNegativeNumber(record.costUsd) ??
    readNonNegativeNumber(record.totalCostUsd) ??
    readNonNegativeNumber(record.total_cost_usd) ??
    providerCostUsd;
  const costSource = readUsageCostSource(record.costSource ?? record.cost_source);
  const billingMode = readUsageBillingMode(record.billingMode ?? record.billing_mode);
  const usageCaptureStatus = readUsageCaptureStatus(
    record.usageCaptureStatus ?? record.usage_capture_status,
  );

  const usage: EvalUsage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(billableInputTokens !== undefined ? { billableInputTokens } : {}),
    ...(billableOutputTokens !== undefined ? { billableOutputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(providerInputCostUsd !== undefined ? { providerInputCostUsd } : {}),
    ...(providerOutputCostUsd !== undefined ? { providerOutputCostUsd } : {}),
    ...(providerCostUsd !== undefined ? { providerCostUsd } : {}),
    ...(veryfrontInputChargeUsd !== undefined ? { veryfrontInputChargeUsd } : {}),
    ...(veryfrontOutputChargeUsd !== undefined ? { veryfrontOutputChargeUsd } : {}),
    ...(veryfrontChargeUsd !== undefined ? { veryfrontChargeUsd } : {}),
    ...(veryfrontBilledUsd !== undefined ? { veryfrontBilledUsd } : {}),
    ...(costCredits !== undefined ? { costCredits } : {}),
    ...(costSource !== undefined ? { costSource } : {}),
    ...(billingMode !== undefined ? { billingMode } : {}),
    ...(usageCaptureStatus !== undefined ? { usageCaptureStatus } : {}),
  };

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function readEvalUsage(value: unknown): EvalUsage | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.usage)) {
    return createUsageFromRecord(value.usage) ?? createUsageFromRecord(value);
  }
  return createUsageFromRecord(value);
}

function getRunFinishedUsage(events: Array<Record<string, unknown>>): EvalUsage | undefined {
  for (const event of [...events].reverse()) {
    const type = getAgUiSseStringField(event, "type");
    if (type === agUiSseEventTypes.runFinished) {
      const usage = readEvalUsage(event.metadata) ?? readEvalUsage(event.usage) ??
        readEvalUsage(event);
      if (usage) return usage;
    }
    if (
      type === agUiSseEventTypes.custom &&
      getAgUiSseStringField(event, "name") === "codex.turn.completed"
    ) {
      const usage = readEvalUsage(event.value);
      if (usage) return usage;
    }
  }
  return undefined;
}

function createRequestInit(
  config: AgentServiceEvalAdapterConfig,
  body: AgentServiceEvalRequestBody,
): RequestInit {
  return {
    method: "POST",
    headers: createHeaders(config),
    body: JSON.stringify(body),
    ...(config.requestTimeoutMs !== undefined
      ? { signal: AbortSignal.timeout(config.requestTimeoutMs) }
      : {}),
  };
}

function assertOptionalAgentServiceConfigString(
  value: string | null | undefined,
  label: string,
): void {
  if (value !== undefined && value !== null) {
    assertCanonicalEvalString(value, label);
  }
}

function assertAgentServiceEvalAdapterConfig(config: AgentServiceEvalAdapterConfig): void {
  assertCanonicalEvalString(config.authToken, "Agent-service eval auth token");
  assertOptionalAgentServiceConfigString(config.endpoint, "Agent-service eval endpoint");
  assertOptionalAgentServiceConfigString(config.agentId, "Agent-service eval agentId");
  if (config.agentId != null && config.agentId !== trustedLocalEvalFetchAgentId(config.fetch)) {
    throw new TypeError(
      `Agent-service evals cannot select agent "${config.agentId}" through public AG-UI; ` +
        "provide a trusted fetch bound to that agent or omit agentId",
    );
  }
  assertOptionalAgentServiceConfigString(config.projectId, "Agent-service eval projectId");
  assertOptionalAgentServiceConfigString(config.projectSlug, "Agent-service eval projectSlug");
  assertOptionalAgentServiceConfigString(config.releaseId, "Agent-service eval releaseId");
  assertOptionalAgentServiceConfigString(
    config.contentSourceId,
    "Agent-service eval contentSourceId",
  );
  assertOptionalAgentServiceConfigString(
    config.conversationId,
    "Agent-service eval conversationId",
  );
  assertOptionalAgentServiceConfigString(config.branchId, "Agent-service eval branchId");
  assertOptionalAgentServiceConfigString(config.branchName, "Agent-service eval branchName");
  assertOptionalAgentServiceConfigString(config.environment, "Agent-service eval environment");
  assertOptionalAgentServiceConfigString(
    config.environmentId,
    "Agent-service eval environmentId",
  );
  assertOptionalAgentServiceConfigString(
    config.forwardedHost,
    "Agent-service eval forwardedHost",
  );
  assertOptionalAgentServiceConfigString(
    config.forwardedProto,
    "Agent-service eval forwardedProto",
  );
  assertOptionalAgentServiceConfigString(config.model, "Agent-service eval model");
  if (config.allowedTools !== undefined) {
    normalizeEvalStringList(config.allowedTools, "Agent-service eval allowedTools");
  }
  if (config.maxSteps !== undefined) {
    assertFiniteEvalNumber(config.maxSteps, "Agent-service eval maxSteps", {
      integer: true,
      min: 1,
    });
  }
  if (config.requestTimeoutMs !== undefined) {
    assertEvalTimerDuration(
      config.requestTimeoutMs,
      "Agent-service eval requestTimeoutMs",
      { min: 1 },
    );
  }
  if (config.progressThrottleMs !== undefined) {
    assertEvalTimerDuration(
      config.progressThrottleMs,
      "Agent-service eval progressThrottleMs",
    );
  }
  if (config.fetch !== undefined && typeof config.fetch !== "function") {
    throw new TypeError("Agent-service eval fetch must be a function");
  }
  if (config.now !== undefined && typeof config.now !== "function") {
    throw new TypeError("Agent-service eval now must be a function");
  }
  if (config.onProgress !== undefined && typeof config.onProgress !== "function") {
    throw new TypeError("Agent-service eval onProgress must be a function");
  }
}

/** Resolve environment values for live agent-service eval execution. */
export function resolveAgentServiceEvalEnvironment(
  env: AgentServiceEvalEnvironmentInput = {},
): AgentServiceEvalEnvironment {
  const projectId = readTrimmedEnvironmentString(env.AG_UI_EVAL_PROJECT_ID);
  const projectSlug = readTrimmedEnvironmentString(env.AG_UI_EVAL_PROJECT_SLUG) ??
    readTrimmedEnvironmentString(env.VERYFRONT_PROJECT_SLUG);
  const branchId = readTrimmedEnvironmentString(env.AG_UI_EVAL_BRANCH_ID);
  const model = readTrimmedEnvironmentString(env.AG_UI_EVAL_MODEL);
  return {
    endpoint: readTrimmedEnvironmentString(env.AG_UI_EVAL_ENDPOINT) ??
      DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT,
    authToken: readTrimmedEnvironmentString(env.VERYFRONT_TOKEN) ?? "",
    apiUrl: resolveAgentServiceEvalApiUrl(env),
    ...(projectId ? { projectId } : {}),
    ...(projectSlug ? { projectSlug } : {}),
    ...(branchId ? { branchId } : {}),
    ...(model ? { model } : {}),
  };
}

/** Evaluate whether the required live agent-service eval environment is present. */
export function evaluateAgentServiceEvalEnvironment(
  env: AgentServiceEvalEnvironmentInput = {},
  resolvedApiUrl = resolveAgentServiceEvalApiUrl(env),
): AgentServiceEvalEnvironmentPreflightResult {
  const messages = [`Resolved VERYFRONT_API_URL: ${resolvedApiUrl}`];
  let hasBlockers = false;

  if (typeof env.VERYFRONT_TOKEN !== "string" || env.VERYFRONT_TOKEN.trim().length === 0) {
    hasBlockers = true;
    messages.push("BLOCKER: VERYFRONT_TOKEN is missing");
  }
  if (
    typeof env.AG_UI_EVAL_PROJECT_ID !== "string" ||
    env.AG_UI_EVAL_PROJECT_ID.trim().length === 0
  ) {
    hasBlockers = true;
    messages.push("BLOCKER: AG_UI_EVAL_PROJECT_ID is missing");
  }

  messages.push(`Agent-service eval preflight: ${hasBlockers ? "FAIL" : "PASS"}`);
  return { ok: !hasBlockers, resolvedApiUrl, messages };
}

/** Build the AG-UI request body for a single eval example. */
export function buildAgentServiceEvalRequestBody(
  input: BuildAgentServiceEvalRequestBodyInput,
): AgentServiceEvalRequestBody {
  const exampleId = normalizeEvalString(input.exampleId, "Agent-service eval example id");
  const veryfront = createVeryfrontForwardedProps(input);
  const metadata = {
    ...getInputMetadata(input.input),
    ...(input.metadata ?? {}),
  };

  return {
    threadId: crypto.randomUUID(),
    runId: `eval-run-${crypto.randomUUID()}`,
    state: {
      ...metadata,
      evalCase: exampleId,
    },
    tools: [],
    context: [],
    ...(veryfront ? { forwardedProps: { veryfront } } : {}),
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: stringifyPromptInput(input.input) }],
      },
    ],
  };
}

/** Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. */
export function createAgentServiceEvalAdapter(
  config: AgentServiceEvalAdapterConfig,
): EvalAgentAdapter {
  assertAgentServiceEvalAdapterConfig(config);
  const requestFetch = config.fetch ?? fetch;
  const endpoint = config.endpoint ?? DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT;

  return async (context): Promise<EvalAgentAdapterResult> => {
    const started = getNow(config);
    if (context.definition.mockTools !== undefined) {
      return {
        text: "",
        output: {
          text: "",
          agUi: {
            responseStatus: 0,
            eventTypes: [],
            runError: "mockTools are only supported by local eval agent execution.",
          },
        },
        trace: {
          events: [],
          toolCalls: [],
        },
        durationMs: getNow(config) - started,
        completed: false,
        error: "mockTools are only supported by local eval agent execution.",
      };
    }
    try {
      const body = buildAgentServiceEvalRequestBody({
        exampleId: context.example.id,
        input: context.example.input,
        metadata: context.example.metadata,
        agentId: undefined,
        projectId: config.projectId,
        conversationId: config.conversationId,
        branchId: config.branchId,
        model: config.model,
        allowedTools: config.allowedTools,
        forceRuntimeOverrides: config.forceRuntimeOverrides,
        maxSteps: config.maxSteps,
      });
      const parseOptions: ParseAgUiSseResponseOptions = {
        ...(config.progressThrottleMs !== undefined
          ? { progressThrottleMs: config.progressThrottleMs }
          : {}),
        ...(config.onProgress
          ? { onProgress: (snapshot) => config.onProgress?.(snapshot, context) }
          : {}),
      };
      const response = await requestFetch(endpoint, createRequestInit(config, body));
      const run = await parseAgUiSseResponse(response, parseOptions);
      const completed = response.ok && run.runError === null &&
        run.eventTypes.includes(agUiSseEventTypes.runFinished);
      const output = createRunOutput(run);
      const usage = getRunFinishedUsage(run.events);

      return {
        text: run.text,
        output,
        trace: {
          events: run.events,
          toolCalls: createToolCalls(run.events),
        },
        ...(usage ? { usage } : {}),
        durationMs: getNow(config) - started,
        completed,
        ...(!completed
          ? { error: run.runError ?? `AG-UI response failed with status ${response.status}` }
          : {}),
      };
    } catch (error) {
      return {
        text: "",
        output: {
          text: "",
          agUi: {
            responseStatus: 0,
            eventTypes: [],
            runError: stringifyEvalError(error),
          },
        },
        trace: {
          events: [],
          toolCalls: [],
        },
        durationMs: getNow(config) - started,
        completed: false,
        error: stringifyEvalError(error),
      };
    }
  };
}
