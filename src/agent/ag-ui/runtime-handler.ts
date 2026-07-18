import { isResponseLike } from "../service/response-like.ts";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
} from "../runtime/index.ts";
import type { Agent, AgentResponse } from "../types.ts";
import {
  type AgUiRuntimeRequest,
  parseAgUiRuntimeRequestOrError,
} from "../runtime/ag-ui-contract.ts";
import { extractRequest } from "./request-shared.ts";
import { type AgUiResumeValue, buildMergedAgUiTools } from "./tool-shared.ts";
import { normalizeAgUiRuntimeMessages } from "./runtime-support.ts";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
} from "#veryfront/internal-agents/ag-ui-sse.ts";
import { streamDataStreamEvents } from "../streaming/data-stream.ts";

const AG_UI_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

type AgUiRuntimePart = Record<string, unknown> & { type: string };

/** Context for AG-UI runtime lifecycle. */
export interface AgUiRuntimeLifecycleContext {
  request: AgUiRuntimeRequest;
  toolCallId?: string;
  error?: unknown;
}

function invokeLifecycleCallback(
  callback: ((context: AgUiRuntimeLifecycleContext) => Promise<void> | void) | undefined,
  context: AgUiRuntimeLifecycleContext,
): void {
  if (!callback) return;

  try {
    const result = callback(context);
    void Promise.resolve(result).catch((error) => {
      agentLogger.error("[AgUiRuntime] Lifecycle callback rejected:", { error });
    });
  } catch (error) {
    agentLogger.error("[AgUiRuntime] Lifecycle callback threw:", { error });
  }
}

async function invokeLifecycleCallbackAndWait(
  callback: ((context: AgUiRuntimeLifecycleContext) => Promise<void> | void) | undefined,
  context: AgUiRuntimeLifecycleContext,
): Promise<void> {
  if (!callback) return;

  try {
    await callback(context);
  } catch (error) {
    agentLogger.error("[AgUiRuntime] Lifecycle callback (await) threw:", { error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildStreamContext(
  request: AgUiRuntimeRequest,
  baseContext: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...baseContext,
    threadId: request.threadId,
    runId: request.runId,
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

async function createAgUiRuntimeStreamResponse(
  options: {
    agentId: string;
    agentName?: string;
    agentAvatarUrl?: string;
    request: AgUiRuntimeRequest;
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
          runId: request.runId,
          threadId: request.threadId,
          agentId,
          ...(agentName ? { agentName } : {}),
          ...(agentAvatarUrl ? { agent_avatar_url: agentAvatarUrl } : {}),
        })
      ) {
        return;
      }
      if (
        !enqueueEvent(controller, "StateSnapshot", {
          snapshot: isRecord(request.state) ? request.state : {},
        })
      ) {
        return;
      }
      if (
        !enqueueEvent(controller, "MessagesSnapshot", {
          messages: normalizeAgUiRuntimeMessages(request.messages),
        })
      ) {
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

async function createAgUiRuntimeDirectStreamResponse(
  agent: Agent,
  request: AgUiRuntimeRequest,
  baseContext: Record<string, unknown>,
  lifecycle?: {
    onFinish?: () => Promise<void> | void;
    onError?: (error: unknown) => Promise<void> | void;
    onToolCallSeen?: (toolCallId: string) => Promise<void> | void;
  },
): Promise<Response> {
  await agent.clearMemory();

  let completedResponse: AgentResponse | null = null;
  const result = await agent.stream({
    messages: normalizeAgUiRuntimeMessages(request.messages),
    context: buildStreamContext(request, baseContext),
    onFinish: (response) => {
      completedResponse = response;
    },
  });

  const upstream = result.toDataStreamResponse();
  return await createAgUiRuntimeStreamResponse({
    agentId: agent.id,
    agentName: agent.config.name ?? agent.id,
    agentAvatarUrl: agent.config.avatarUrl ?? agent.config.avatar_url,
    request,
    upstreamBody: upstream.body,
    upstreamStatus: upstream.status,
    upstreamStatusText: upstream.statusText,
    getCompletedResponse: () => completedResponse,
    onFinish: lifecycle?.onFinish,
    onError: lifecycle?.onError,
    onToolCallSeen: lifecycle?.onToolCallSeen,
  });
}

function buildMergedTools(
  agent: Agent,
  request: AgUiRuntimeRequest,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Agent["config"]["tools"] {
  return buildMergedAgUiTools(agent, request.runId, request.tools, sessionManager);
}

async function createAgUiRuntimeInjectedToolsStreamResponse(
  agent: Agent,
  request: AgUiRuntimeRequest,
  baseContext: Record<string, unknown>,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
  lifecycle?: {
    onFinish?: () => Promise<void> | void;
    onError?: (error: unknown) => Promise<void> | void;
    onToolCallSeen?: (toolCallId: string) => Promise<void> | void;
  },
): Promise<Response> {
  try {
    sessionManager.startRun({ runId: request.runId, threadId: request.threadId });
  } catch (error) {
    if (error instanceof RunAlreadyExistsError) {
      return Response.json({ error: "Run already active" }, { status: 409 });
    }
    throw error;
  }

  const runtime = new AgentRuntime(agent.id, {
    ...agent.config,
    tools: buildMergedTools(agent, request, sessionManager),
  });

  let upstreamBody: ReadableStream<Uint8Array>;
  let completedResponse: AgentResponse | null = null;
  try {
    upstreamBody = await runtime.stream(
      normalizeAgUiRuntimeMessages(request.messages),
      buildStreamContext(request, baseContext),
      {
        onFinish: (response) => {
          completedResponse = response;
        },
      },
      undefined,
      undefined,
    );
  } catch (error) {
    sessionManager.failRun(request.runId);
    throw error;
  }

  return await createAgUiRuntimeStreamResponse({
    agentId: agent.id,
    agentName: agent.config.name ?? agent.id,
    agentAvatarUrl: agent.config.avatarUrl ?? agent.config.avatar_url,
    request,
    upstreamBody,
    upstreamStatus: 200,
    getCompletedResponse: () => completedResponse,
    onFinish: () => {
      sessionManager.completeRun(request.runId);
      void lifecycle?.onFinish?.();
    },
    onError: (error) => {
      sessionManager.failRun(request.runId);
      void lifecycle?.onError?.(error);
    },
    onToolCallSeen: (toolCallId) => {
      void lifecycle?.onToolCallSeen?.(toolCallId);
    },
  });
}

/** Input payload for AG-UI runtime handler execute. */
export interface AgUiRuntimeHandlerExecuteInput {
  request: Request;
  agUiInput: AgUiRuntimeRequest;
  context: Record<string, unknown>;
  createDefaultResponse?: () => Promise<Response>;
}

/** Public API contract for AG-UI runtime handler execute. */
export type AgUiRuntimeHandlerExecute = (
  input: AgUiRuntimeHandlerExecuteInput,
) => Promise<Response> | Response;

export interface AgUiRuntimeRequestGateInput {
  request: Request;
}

export type AgUiRuntimeRequestGate = (
  input: AgUiRuntimeRequestGateInput,
) => Promise<Response | undefined | void> | Response | undefined | void;

export interface AgUiRuntimeValidationErrorInput {
  request: Request;
  response: Response;
}

export type AgUiRuntimeValidationErrorResponse = (
  input: AgUiRuntimeValidationErrorInput,
) => Promise<Response> | Response;

/** Options accepted by AG-UI runtime handler. */
export interface AgUiRuntimeHandlerOptions {
  context?:
    | Record<string, unknown>
    | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);
  beforeParse?: AgUiRuntimeRequestGate;
  validationErrorResponse?: AgUiRuntimeValidationErrorResponse;
  sessionManager?: RunResumeSessionManager<AgUiResumeValue>;
  execute?: AgUiRuntimeHandlerExecute;
  onToolCallSeen?: (context: AgUiRuntimeLifecycleContext) => Promise<void> | void;
  onFinish?: (context: AgUiRuntimeLifecycleContext) => Promise<void> | void;
  onError?: (context: AgUiRuntimeLifecycleContext) => Promise<void> | void;
}

/** Public API contract for AG-UI runtime handler config with agent. */
export interface AgUiRuntimeHandlerConfigWithAgent extends AgUiRuntimeHandlerOptions {
  agent: Agent;
}

/** Configuration used by AG-UI runtime handler. */
export type AgUiRuntimeHandlerConfig =
  | AgUiRuntimeHandlerConfigWithAgent
  | (AgUiRuntimeHandlerOptions & { agent?: undefined; execute: AgUiRuntimeHandlerExecute });

/** Handler for create AG-UI runtime. */
export function createAgUiRuntimeHandler(
  config: AgUiRuntimeHandlerConfig,
): (requestOrCtx: unknown) => Promise<Response> {
  if (!config.agent && !config.execute) {
    throw INVALID_ARGUMENT.create({
      detail: "createAgUiRuntimeHandler requires either an agent or an execute handler.",
    });
  }

  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);

    try {
      const gateResult = await config.beforeParse?.({ request });
      if (isResponseLike(gateResult)) {
        return gateResult;
      }

      const parsed = await parseAgUiRuntimeRequestOrError(request);
      if (isResponseLike(parsed)) {
        if (config.validationErrorResponse) {
          return await config.validationErrorResponse({ request, response: parsed });
        }

        return parsed;
      }

      const context = typeof config.context === "function"
        ? await config.context(request)
        : config.context ?? {};

      const createDefaultResponse = config.agent
        ? () =>
          parsed.tools.length > 0
            ? config.sessionManager
              ? createAgUiRuntimeInjectedToolsStreamResponse(
                config.agent,
                parsed,
                context,
                config.sessionManager,
              )
              : Promise.resolve(
                Response.json(
                  {
                    error:
                      "Injected AG-UI tools require a public RunResumeSessionManager on createAgUiRuntimeHandler().",
                  },
                  { status: 501 },
                ),
              )
            : createAgUiRuntimeDirectStreamResponse(config.agent, parsed, context)
        : undefined;

      const invokeLifecycle = (
        type: "onFinish" | "onError" | "onToolCallSeen",
        extra: Partial<AgUiRuntimeLifecycleContext> = {},
      ): void => {
        invokeLifecycleCallback(config[type], {
          request: parsed,
          ...extra,
        });
      };

      const createDefaultResponseWithLifecycle = createDefaultResponse
        ? async () => {
          try {
            if (!config.agent) {
              return await createDefaultResponse();
            }

            if (parsed.tools.length > 0) {
              if (!config.sessionManager) {
                return await createDefaultResponse();
              }

              return await createAgUiRuntimeInjectedToolsStreamResponse(
                config.agent,
                parsed,
                context,
                config.sessionManager,
                {
                  onFinish: () => invokeLifecycle("onFinish"),
                  onError: (error) => invokeLifecycle("onError", { error }),
                  onToolCallSeen: (toolCallId) => invokeLifecycle("onToolCallSeen", { toolCallId }),
                },
              );
            }

            return await createAgUiRuntimeDirectStreamResponse(
              config.agent,
              parsed,
              context,
              {
                onFinish: () => invokeLifecycle("onFinish"),
                onError: (error) => invokeLifecycle("onError", { error }),
                onToolCallSeen: (toolCallId) => invokeLifecycle("onToolCallSeen", { toolCallId }),
              },
            );
          } catch (error) {
            await invokeLifecycleCallbackAndWait(config.onError, {
              request: parsed,
              error,
            });
            throw error;
          }
        }
        : undefined;

      if (config.execute) {
        return await config.execute({
          request,
          agUiInput: parsed,
          context,
          createDefaultResponse: createDefaultResponseWithLifecycle,
        });
      }

      if (createDefaultResponseWithLifecycle) {
        return await createDefaultResponseWithLifecycle();
      }

      throw INITIALIZATION_ERROR.create({ detail: "createAgUiRuntimeHandler configuration became invalid during execution." });
    } catch (error) {
      if (
        error instanceof Error &&
        "issues" in error &&
        Array.isArray((error as Record<string, unknown>).issues)
      ) {
        const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
        return Response.json(
          {
            error: "Invalid AG-UI runtime request",
            details: issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
          },
          { status: 400 },
        );
      }

      return Response.json(
        {
          error: error instanceof Error ? error.message : "Internal server error",
        },
        { status: 500 },
      );
    }
  };
}
