import {
  agUiSseEventTypes,
  type AgUiSseProgressSnapshot,
  getAgUiSseStringField,
  parseAgentServiceConfig,
  parseAgUiSseResponse,
  type ParseAgUiSseResponseOptions,
} from "#veryfront/agent";
import type {
  EvalAgentAdapter,
  EvalAgentAdapterContext,
  EvalAgentAdapterResult,
  EvalToolCall,
} from "./types.ts";

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
    content: string;
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  return JSON.stringify(input);
}

function getInputMetadata(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || !isRecord(input.metadata)) return {};
  return { ...input.metadata };
}

function getRequestOverrides(input: BuildAgentServiceEvalRequestBodyInput) {
  const record = isRecord(input.input) ? input.input : {};
  return {
    agentId: input.agentId ?? null,
    projectId: input.projectId ?? readString(record.projectId) ?? null,
    conversationId: input.conversationId ?? readString(record.conversationId) ?? null,
    branchId: input.branchId ?? readString(record.branchId) ?? null,
    model: input.model ?? readString(record.model) ?? null,
    allowedTools: input.allowedTools ?? readStringArray(record.allowedTools),
    forceRuntimeOverrides: input.forceRuntimeOverrides ?? record.forceRuntimeOverrides === true,
    maxSteps: input.maxSteps ?? readNumber(record.maxSteps),
  };
}

function createVeryfrontForwardedProps(
  input: BuildAgentServiceEvalRequestBodyInput,
): AgentServiceEvalForwardedProps | null {
  const overrides = getRequestOverrides(input);
  const veryfront: AgentServiceEvalForwardedProps = {};

  if (overrides.agentId) veryfront.agentId = overrides.agentId;
  if (overrides.projectId) veryfront.projectId = overrides.projectId;
  if (overrides.conversationId) veryfront.conversationId = overrides.conversationId;
  if (overrides.branchId) veryfront.branchId = overrides.branchId;
  if (overrides.model) veryfront.model = overrides.model;

  const shouldForwardRuntimeOverrides = !!overrides.allowedTools ||
    overrides.forceRuntimeOverrides ||
    overrides.maxSteps !== undefined;
  if (shouldForwardRuntimeOverrides) {
    veryfront.runtimeOverrides = {
      ...(overrides.allowedTools ? { allowedTools: overrides.allowedTools } : {}),
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
    return String(value);
  }
}

function getToolResultError(event: Record<string, unknown>): string | undefined {
  return stringifyError(event.result) ?? stringifyError(event.content) ?? "Tool call failed";
}

function createToolCalls(events: Array<Record<string, unknown>>): EvalToolCall[] {
  const toolCalls = new Map<string, EvalToolCall>();

  for (const [index, event] of events.entries()) {
    const type = getAgUiSseStringField(event, "type");

    if (type === agUiSseEventTypes.toolCallStart) {
      const name = getAgUiSseStringField(event, "toolCallName");
      if (!name) continue;

      const id = getAgUiSseStringField(event, "toolCallId");
      const key = id ?? `name:${name}`;
      const existing = toolCalls.get(key);
      toolCalls.set(key, {
        name,
        status: existing?.status ?? "ok",
        ...(existing?.error ? { error: existing.error } : {}),
        ...(existing?.metadata ? { metadata: existing.metadata } : {}),
      });
      continue;
    }

    if (type === agUiSseEventTypes.toolCallResult) {
      const id = getAgUiSseStringField(event, "toolCallId");
      const toolName = getAgUiSseStringField(event, "toolCallName");
      const key = id ?? (toolName ? `name:${toolName}` : `result:${index}`);
      const existing = toolCalls.get(key);
      const failed = event.isError === true;
      toolCalls.set(key, {
        name: existing?.name ?? toolName ?? "tool",
        status: failed ? "error" : existing?.status ?? "ok",
        ...(failed ? { error: getToolResultError(event) } : {}),
        ...(existing?.metadata ? { metadata: existing.metadata } : {}),
      });
    }
  }

  return [...toolCalls.values()];
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

function createRequestInit(
  config: AgentServiceEvalAdapterConfig,
  body: AgentServiceEvalRequestBody,
): RequestInit {
  return {
    method: "POST",
    headers: createHeaders(config),
    body: JSON.stringify(body),
    ...(config.requestTimeoutMs ? { signal: AbortSignal.timeout(config.requestTimeoutMs) } : {}),
  };
}

/** Resolve environment values for live agent-service eval execution. */
export function resolveAgentServiceEvalEnvironment(
  env: AgentServiceEvalEnvironmentInput = {},
): AgentServiceEvalEnvironment {
  return {
    endpoint: typeof env.AG_UI_EVAL_ENDPOINT === "string"
      ? env.AG_UI_EVAL_ENDPOINT
      : DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT,
    authToken: typeof env.VERYFRONT_TOKEN === "string" ? env.VERYFRONT_TOKEN : "",
    apiUrl: typeof env.VERYFRONT_API_URL === "string"
      ? env.VERYFRONT_API_URL
      : parseAgentServiceConfig(env).VERYFRONT_API_URL,
    ...(typeof env.AG_UI_EVAL_PROJECT_ID === "string"
      ? { projectId: env.AG_UI_EVAL_PROJECT_ID }
      : {}),
    ...(typeof env.AG_UI_EVAL_PROJECT_SLUG === "string"
      ? { projectSlug: env.AG_UI_EVAL_PROJECT_SLUG }
      : typeof env.VERYFRONT_PROJECT_SLUG === "string"
      ? { projectSlug: env.VERYFRONT_PROJECT_SLUG }
      : {}),
    ...(typeof env.AG_UI_EVAL_BRANCH_ID === "string" ? { branchId: env.AG_UI_EVAL_BRANCH_ID } : {}),
    ...(typeof env.AG_UI_EVAL_MODEL === "string" ? { model: env.AG_UI_EVAL_MODEL } : {}),
  };
}

/** Evaluate whether the required live agent-service eval environment is present. */
export function evaluateAgentServiceEvalEnvironment(
  env: AgentServiceEvalEnvironmentInput = {},
  resolvedApiUrl = parseAgentServiceConfig(env).VERYFRONT_API_URL,
): AgentServiceEvalEnvironmentPreflightResult {
  const messages = [`Resolved VERYFRONT_API_URL: ${resolvedApiUrl}`];
  let hasBlockers = false;

  if (typeof env.VERYFRONT_TOKEN !== "string" || env.VERYFRONT_TOKEN.length === 0) {
    hasBlockers = true;
    messages.push("BLOCKER: VERYFRONT_TOKEN is missing");
  }
  if (typeof env.AG_UI_EVAL_PROJECT_ID !== "string" || env.AG_UI_EVAL_PROJECT_ID.length === 0) {
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
  const veryfront = createVeryfrontForwardedProps(input);
  const metadata = {
    ...getInputMetadata(input.input),
    ...(input.metadata ?? {}),
  };

  return {
    threadId: crypto.randomUUID(),
    runId: `eval-run-${crypto.randomUUID()}`,
    state: {
      evalCase: input.exampleId,
      ...metadata,
    },
    tools: [],
    context: [],
    ...(veryfront ? { forwardedProps: { veryfront } } : {}),
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: stringifyPromptInput(input.input),
      },
    ],
  };
}

/** Create an `EvalAgentAdapter` that executes examples against an AG-UI agent-service endpoint. */
export function createAgentServiceEvalAdapter(
  config: AgentServiceEvalAdapterConfig,
): EvalAgentAdapter {
  const requestFetch = config.fetch ?? fetch;
  const endpoint = config.endpoint ?? DEFAULT_AGENT_SERVICE_EVAL_ENDPOINT;

  return async (context): Promise<EvalAgentAdapterResult> => {
    const started = getNow(config);
    const body = buildAgentServiceEvalRequestBody({
      exampleId: context.example.id,
      input: context.example.input,
      metadata: context.example.metadata,
      agentId: config.agentId,
      projectId: config.projectId,
      conversationId: config.conversationId,
      branchId: config.branchId,
      model: config.model,
      allowedTools: config.allowedTools,
      forceRuntimeOverrides: config.forceRuntimeOverrides,
      maxSteps: config.maxSteps,
    });

    try {
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

      return {
        text: run.text,
        output,
        trace: {
          events: run.events,
          toolCalls: createToolCalls(run.events),
        },
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
            runError: error instanceof Error ? error.message : String(error),
          },
        },
        trace: {
          events: [],
          toolCalls: [],
        },
        durationMs: getNow(config) - started,
        completed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
