import { isResponseLike } from "../service/response-like.ts";
import { getAgent } from "../composition/index.ts";
import type { Agent, AgentResponse } from "../types.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
} from "../runtime/index.ts";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
} from "#veryfront/internal-agents/ag-ui-sse.ts";
import { streamDataStreamEvents } from "../streaming/data-stream.ts";
import {
  createToolExecutionDataEventBridgeStream,
  type ToolExecutionDataEventPublisher,
} from "../streaming/tool-execution-data-event-bridge.ts";
import {
  type AgUiBeforeStream,
  applyBeforeStreamResult,
  extractLastUserText,
} from "../service/before-stream.ts";
import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import {
  type AgUiRequest,
  normalizeAgUiMessages,
  parseAgUiRequestOrError,
} from "./host-support.ts";
import { extractRequest } from "./request-shared.ts";
import { type AgUiResumeValue, buildMergedAgUiTools } from "./tool-shared.ts";

export {
  type AgUiContextItem,
  AgUiContextItemSchema,
  type AgUiInjectedTool,
  AgUiInjectedToolSchema,
  type AgUiRequest,
  AgUiRequestSchema,
} from "./host-support.ts";

const AG_UI_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function isModelCredentialError(error: ReturnType<typeof fromError>): boolean {
  if (!error) return false;
  if (error.type === "no_ai_available") return true;
  if (error.type !== "config") return false;

  const message = error.message.toLowerCase();
  return (
    (message.includes("not set") || message.includes("missing credentials")) &&
    (
      message.includes("api_key") ||
      message.includes("api token") ||
      message.includes("veryfront_api_token") ||
      message.includes("credentials")
    )
  );
}

type AgUiRuntimePart = Record<string, unknown> & { type: string };

function generateRunId(): string {
  return `run_${crypto.randomUUID().replaceAll("-", "")}`;
}

function getProviderToolNames(agent: Agent): string[] {
  return Array.isArray(agent.config.providerTools)
    ? agent.config.providerTools.filter((toolName): toolName is string =>
      typeof toolName === "string" && toolName.length > 0
    )
    : [];
}

function createToolDataEventBridge() {
  const pendingEvents: ToolExecutionDataEvent[] = [];
  let publishDataEvent: ToolExecutionDataEventPublisher = (event) => {
    pendingEvents.push(event);
  };

  return {
    publishDataEvent: (event: ToolExecutionDataEvent) => publishDataEvent(event),
    wrapStream(baseStream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
      return createToolExecutionDataEventBridgeStream({
        baseStream,
        installPublisher(nextPublishDataEvent) {
          publishDataEvent = nextPublishDataEvent;
          while (pendingEvents.length > 0) {
            const event = pendingEvents.shift();
            if (event) publishDataEvent(event);
          }
        },
      });
    },
  };
}

function buildStreamContext(
  request: AgUiRequest,
  baseContext: Record<string, unknown>,
  threadId: string,
  runId: string,
): Record<string, unknown> {
  return {
    ...baseContext,
    threadId,
    runId,
    agUi: {
      context: request.context,
      forwardedProps: request.forwardedProps,
    },
  };
}

function closeController(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close();
  } catch {
    return;
  }
}

function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  payload: Record<string, unknown>,
): boolean {
  try {
    controller.enqueue(formatAgUiEvent(event, payload));
    return true;
  } catch {
    return false;
  }
}

async function createAgUiStreamResponse(
  options: {
    agentId: string;
    agentName?: string;
    agentAvatarUrl?: string;
    request: AgUiRequest;
    runId: string;
    threadId: string;
    upstreamBody: ReadableStream<Uint8Array> | null;
    upstreamStatus: number;
    upstreamStatusText?: string;
    getCompletedResponse?: () => AgentResponse | null;
    onFinish?: () => void;
    onError?: (error: unknown) => void;
    onToolCallSeen?: (toolCallId: string) => void;
  },
): Promise<Response> {
  const {
    agentId,
    agentName,
    agentAvatarUrl,
    request,
    runId,
    threadId,
    upstreamBody,
    upstreamStatus,
    upstreamStatusText,
    getCompletedResponse,
    onFinish,
    onError,
    onToolCallSeen,
  } = options;

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const state = createStreamTransformState();
      const prepareToolResultIfNeeded = (event: string, payload: Record<string, unknown>) => {
        if (
          event !== "ToolCallStart" && event !== "ToolCallArgs" &&
          event !== "ToolCallEnd"
        ) {
          return;
        }

        const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : null;
        if (toolCallId) {
          onToolCallSeen?.(toolCallId);
        }
      };

      if (
        !enqueueEvent(controller, "RunStarted", {
          runId,
          threadId,
          agentId,
          ...(agentName ? { agentName } : {}),
          ...(agentAvatarUrl ? { agent_avatar_url: agentAvatarUrl } : {}),
        })
      ) {
        return;
      }
      if (!enqueueEvent(controller, "StateSnapshot", { snapshot: {} })) {
        return;
      }
      if (!enqueueEvent(controller, "MessagesSnapshot", { messages: request.messages })) {
        return;
      }

      try {
        if (!upstreamBody) {
          for (const event of finalizeRunEvents(state, null)) {
            if (!enqueueEvent(controller, event.event, event.payload)) {
              return;
            }
          }
          onFinish?.();
          closeController(controller);
          return;
        }

        for await (
          const event of streamDataStreamEvents(upstreamBody) as AsyncIterable<AgUiRuntimePart>
        ) {
          for (const mapped of mapRuntimeEventToAgUi(state, event)) {
            prepareToolResultIfNeeded(mapped.event, mapped.payload);
            if (!enqueueEvent(controller, mapped.event, mapped.payload)) {
              return;
            }
          }
        }

        for (const event of finalizeRunEvents(state, getCompletedResponse?.() ?? null)) {
          if (!enqueueEvent(controller, event.event, event.payload)) {
            return;
          }
        }
        onFinish?.();
      } catch (error) {
        onError?.(error);
        enqueueEvent(controller, "RunError", {
          message: error instanceof Error ? error.message : "Agent run failed",
        });
      } finally {
        closeController(controller);
      }
    },
  });

  return new Response(stream, {
    status: upstreamStatus,
    statusText: upstreamStatusText,
    headers: { ...AG_UI_HEADERS },
  });
}

async function createAgUiDirectStreamResponse(
  agent: Agent,
  request: AgUiRequest,
  rawRequest: Request,
  baseContext: Record<string, unknown>,
  beforeStream?: AgUiBeforeStream,
): Promise<Response> {
  const threadId = request.threadId ?? crypto.randomUUID();
  const runId = request.runId ?? generateRunId();
  const context = buildStreamContext(request, baseContext, threadId, runId);
  let messages = normalizeAgUiMessages(request.messages, {
    providerOwnedToolNames: getProviderToolNames(agent),
  });

  const beforeStreamResult = await beforeStream?.({
    request: rawRequest,
    messages,
    context,
    lastUserText: extractLastUserText(messages),
  });
  if (isResponseLike(beforeStreamResult)) return beforeStreamResult;

  messages = applyBeforeStreamResult(messages, beforeStreamResult ?? undefined);
  const finalContext = beforeStreamResult?.context ?? context;

  await agent.clearMemory();

  const toolDataEvents = createToolDataEventBridge();
  let completedResponse: AgentResponse | null = null;
  const result = await agent.stream({
    messages,
    context: {
      ...finalContext,
      publishDataEvent: toolDataEvents.publishDataEvent,
    },
    ...(request.model ? { model: request.model } : {}),
    ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
    onFinish: (response) => {
      completedResponse = response;
    },
  });

  const upstream = result.toDataStreamResponse();
  const upstreamBody = upstream.body ? toolDataEvents.wrapStream(upstream.body) : upstream.body;
  return await createAgUiStreamResponse({
    agentId: agent.id,
    agentName: agent.config.name ?? agent.id,
    agentAvatarUrl: agent.config.avatarUrl ?? agent.config.avatar_url,
    request,
    runId,
    threadId,
    upstreamBody,
    upstreamStatus: upstream.status,
    upstreamStatusText: upstream.statusText,
    getCompletedResponse: () => completedResponse,
  });
}

async function createAgUiInjectedToolsStreamResponse(
  agent: Agent,
  request: AgUiRequest,
  rawRequest: Request,
  baseContext: Record<string, unknown>,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
  beforeStream?: AgUiBeforeStream,
): Promise<Response> {
  const threadId = request.threadId ?? crypto.randomUUID();
  const runId = request.runId ?? generateRunId();
  const context = buildStreamContext(request, baseContext, threadId, runId);
  let messages = normalizeAgUiMessages(request.messages, {
    providerOwnedToolNames: getProviderToolNames(agent),
  });

  const beforeStreamResult = await beforeStream?.({
    request: rawRequest,
    messages,
    context,
    lastUserText: extractLastUserText(messages),
  });
  if (isResponseLike(beforeStreamResult)) return beforeStreamResult;

  messages = applyBeforeStreamResult(messages, beforeStreamResult ?? undefined);
  const finalContext = beforeStreamResult?.context ?? context;

  try {
    sessionManager.startRun({ runId, threadId });
  } catch (error) {
    if (error instanceof RunAlreadyExistsError) {
      return Response.json({ error: "Run already active" }, { status: 409 });
    }
    throw error;
  }

  const runtime = new AgentRuntime(agent.id, {
    ...agent.config,
    tools: buildMergedAgUiTools(agent, runId, request.tools, sessionManager),
  });

  let upstreamBody: ReadableStream<Uint8Array>;
  let completedResponse: AgentResponse | null = null;
  const toolDataEvents = createToolDataEventBridge();
  try {
    upstreamBody = await runtime.stream(
      messages,
      {
        ...finalContext,
        publishDataEvent: toolDataEvents.publishDataEvent,
      },
      {
        onFinish: (response) => {
          completedResponse = response;
        },
      },
      request.model,
      request.maxOutputTokens,
    );
    upstreamBody = toolDataEvents.wrapStream(upstreamBody);
  } catch (error) {
    sessionManager.failRun(runId);
    throw error;
  }

  return await createAgUiStreamResponse({
    agentId: agent.id,
    agentName: agent.config.name ?? agent.id,
    agentAvatarUrl: agent.config.avatarUrl ?? agent.config.avatar_url,
    request,
    runId,
    threadId,
    upstreamBody,
    upstreamStatus: 200,
    getCompletedResponse: () => completedResponse,
    onFinish: () => {
      sessionManager.completeRun(runId);
    },
    onError: () => {
      sessionManager.failRun(runId);
    },
  });
}

/** Options accepted by AG-UI handler. */
export interface AgUiHandlerOptions {
  context?:
    | Record<string, unknown>
    | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);
  sessionManager?: RunResumeSessionManager<AgUiResumeValue>;
  beforeStream?: AgUiBeforeStream;
}

/** Public API contract for AG-UI handler config with agent. */
export interface AgUiHandlerConfigWithAgent extends AgUiHandlerOptions {
  agent: Agent;
}

function mergeConfig(
  config: AgUiHandlerConfigWithAgent,
  options?: AgUiHandlerOptions,
): AgUiHandlerConfigWithAgent {
  if (!options) return config;
  return { ...options, ...config };
}

/** Handler for create AG-UI. */
export function createAgUiHandler(
  agentId: string,
  options?: AgUiHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response>;
/** Handler for create AG-UI. */
export function createAgUiHandler(
  config: AgUiHandlerConfigWithAgent,
  options?: AgUiHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response>;
/** Handler for create AG-UI. */
export function createAgUiHandler(
  agentIdOrConfig: string | AgUiHandlerConfigWithAgent,
  options?: AgUiHandlerOptions,
) {
  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);

    let agent: Agent | undefined;

    if (
      typeof agentIdOrConfig === "object" &&
      agentIdOrConfig !== null &&
      "agent" in agentIdOrConfig
    ) {
      const config = mergeConfig(agentIdOrConfig, options);
      agent = config.agent;
      options = config;
    } else {
      const agentId = agentIdOrConfig as string;
      try {
        agent = getAgent(agentId);
      } catch {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }
    }

    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    try {
      const parsed = await parseAgUiRequestOrError(request);
      if (isResponseLike(parsed)) {
        return parsed;
      }

      if (parsed.tools.length > 0) {
        if (!options?.sessionManager) {
          return Response.json(
            {
              error:
                "Injected AG-UI tools require a public RunResumeSessionManager on createAgUiHandler().",
            },
            { status: 501 },
          );
        }

        const context = typeof options?.context === "function"
          ? await options.context(request)
          : options?.context ?? {};

        return await createAgUiInjectedToolsStreamResponse(
          agent,
          parsed,
          request,
          context,
          options.sessionManager,
          options?.beforeStream,
        );
      }

      const context = typeof options?.context === "function"
        ? await options.context(request)
        : options?.context ?? {};

      return await createAgUiDirectStreamResponse(
        agent,
        parsed,
        request,
        context,
        options?.beforeStream,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "issues" in error &&
        Array.isArray((error as Record<string, unknown>).issues)
      ) {
        const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
        return Response.json(
          {
            error: "Invalid AG-UI request",
            details: issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
          },
          { status: 400 },
        );
      }

      const vfError = fromError(error);
      if (isModelCredentialError(vfError)) {
        return Response.json(
          {
            code: vfError?.type === "no_ai_available" ? "NO_AI_AVAILABLE" : "NO_MODEL_CREDENTIALS",
            error:
              "No model credentials configured. Run veryfront login or set VERYFRONT_API_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.",
          },
          { status: 503 },
        );
      }

      return Response.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
