import { isResponseLike } from "../service/response-like.ts";
import { getAgent } from "../composition/index.ts";
import { createEphemeralAgent } from "../factory.ts";
import type { Agent, AgentResponse, Message } from "../types.ts";
import { fromError } from "#veryfront/errors";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
  streamWithAgentRuntimeDispatch,
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
import {
  type AgUiRuntimeRestrictions,
  applyAgUiRuntimeRestrictionsForModel,
  hasAgUiRuntimeRestrictions,
} from "./runtime-restrictions.ts";
import { createApplicationRequest } from "#veryfront/security/http/application-request.ts";

export {
  type AgUiRuntimeRestrictions,
  applyAgUiRuntimeRestrictions,
  hasAgUiRuntimeRestrictions,
} from "./runtime-restrictions.ts";

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

/**
 * Payload handed to {@link AgUiHandlerOptions.onComplete} after an AG-UI run
 * streams to completion successfully — the server-side counterpart to the
 * client's `useConversationChat` persistence path. Lets an application persist
 * the finalized conversation without reconstructing it from the SSE stream.
 */
export interface AgUiCompletion {
  agentId: string;
  threadId: string;
  runId: string;
  /**
   * The finalized messages this run produced (the assistant turn plus any tool
   * messages), as returned by the agent's own `onFinish`.
   */
  messages: Message[];
  /** The messages sent to the agent for this run (after `beforeStream`). */
  inputMessages: Message[];
  /** The full finalized response (text, toolCalls, usage, metadata). */
  response: AgentResponse;
}

/**
 * Called once after a successful AG-UI run with the finalized conversation.
 *
 * Semantics:
 * - Fires exactly once, and only on success (a run that produced a finalized
 *   response). It does NOT fire on error, or when the client disconnects before
 *   the stream finishes.
 * - Runs after the SSE stream has been fully flushed and closed, so a slow or
 *   throwing persistence never delays or corrupts the response stream.
 * - A rejected/throwing callback is caught and logged (never rethrown into the
 *   stream); the run is still considered complete.
 */
export type AgUiOnComplete = (completion: AgUiCompletion) => void | Promise<void>;

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
  const configuredRunIdBinding = baseContext.runIdBindsToolAuthorization;
  return {
    ...baseContext,
    threadId,
    runId,
    // A trusted server context can mark locally generated client IDs, such as
    // eval IDs, as non-binding. Other client-supplied IDs keep existing behavior.
    runIdBindsToolAuthorization: typeof configuredRunIdBinding === "boolean"
      ? configuredRunIdBinding
      : request.runId === undefined
      ? false
      : undefined,
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
    /**
     * Fired once, after the stream is fully flushed and closed, with the
     * finalized response — only when the run succeeded and produced one.
     */
    onComplete?: (response: AgentResponse) => void | Promise<void>;
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
    onComplete,
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

      // Fires the completion callback exactly once, after the stream is closed,
      // so persistence never delays or corrupts the response. Only set on the
      // success paths below — a client disconnect early-returns before this is
      // flipped, and the error path leaves it false.
      let succeeded = false;
      try {
        if (!upstreamBody) {
          for (const event of finalizeRunEvents(state, null)) {
            if (!enqueueEvent(controller, event.event, event.payload)) {
              return;
            }
          }
          onFinish?.();
          succeeded = true;
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
        succeeded = true;
      } catch (error) {
        onError?.(error);
        enqueueEvent(controller, "RunError", {
          message: error instanceof Error ? error.message : "Agent run failed",
        });
      } finally {
        closeController(controller);
        // Persist AFTER the stream is closed: a finalized response is required,
        // and a throwing callback is contained (logged, never rethrown).
        if (succeeded && onComplete) {
          const response = getCompletedResponse?.() ?? null;
          if (response) {
            try {
              await onComplete(response);
            } catch (error) {
              console.error("[AgUi] onComplete callback threw:", error);
            }
          }
        }
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
  onComplete?: AgUiOnComplete,
  restrictions?: AgUiRuntimeRestrictions,
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
  // beforeStream may return a fresh context, dropping the generated-run marker.
  const finalContext = {
    ...(beforeStreamResult?.context ?? context),
    runIdBindsToolAuthorization: context.runIdBindsToolAuthorization,
  };

  const toolDataEvents = createToolDataEventBridge();
  let completedResponse: AgentResponse | null = null;
  const streamContext = {
    ...finalContext,
    publishDataEvent: toolDataEvents.publishDataEvent,
  };
  const onFinish = (response: AgentResponse) => {
    completedResponse = response;
  };

  // `agent.stream()` runs the agent's own runtime, which carries its full
  // configured tool surface. A restricted run therefore streams through an
  // unregistered agent rebuilt by the same factory from the narrowed
  // configuration: the ceiling binds tool exposure and execution instead of
  // travelling as unenforced request metadata, while the run keeps the
  // framework's own prompt composition (project and environment context, and
  // the skill catalog only when the loader survives the ceiling), security
  // middleware, resolved skill-selector context, and private runtime dispatch.
  const streamAgent = hasAgUiRuntimeRestrictions(restrictions)
    ? createEphemeralAgent({
      ...applyAgUiRuntimeRestrictionsForModel(
        agent.config,
        restrictions,
        request.model,
        agent.id,
      ),
      // A factory-assigned id lives on `agent.id` while `agent.config.id`
      // stays undefined. Rebuilding without it would mint a fresh id, hiding
      // owner-scoped registry tools and skills from the restricted run and
      // handing hooks such as `resolveModelTransport` the wrong identity.
      id: agent.id,
    })
    : agent;

  // A restricted run uses a fresh ephemeral agent, so it has no prior memory
  // to clear. Do not call mutable methods on the source agent before the
  // capability ceiling is in place.
  if (streamAgent === agent) await agent.clearMemory();

  const result = await streamAgent.stream({
    messages,
    context: streamContext,
    ...(request.model ? { model: request.model } : {}),
    ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
    onFinish,
  });

  const upstream = result.toDataStreamResponse();
  const upstreamBody = upstream.body ? toolDataEvents.wrapStream(upstream.body) : upstream.body;
  const upstreamStatus = upstream.status;
  const upstreamStatusText = upstream.statusText;

  return await createAgUiStreamResponse({
    agentId: agent.id,
    agentName: agent.config.name ?? agent.id,
    agentAvatarUrl: agent.config.avatarUrl ?? agent.config.avatar_url,
    request,
    runId,
    threadId,
    upstreamBody,
    upstreamStatus,
    upstreamStatusText,
    getCompletedResponse: () => completedResponse,
    onComplete: onComplete
      ? (response) =>
        onComplete({
          agentId: agent.id,
          threadId,
          runId,
          messages: response.messages,
          inputMessages: messages,
          response,
        })
      : undefined,
  });
}

async function createAgUiInjectedToolsStreamResponse(
  agent: Agent,
  request: AgUiRequest,
  rawRequest: Request,
  baseContext: Record<string, unknown>,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
  beforeStream?: AgUiBeforeStream,
  onComplete?: AgUiOnComplete,
  restrictions?: AgUiRuntimeRestrictions,
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
  // beforeStream may return a fresh context, dropping the generated-run marker.
  const finalContext = {
    ...(beforeStreamResult?.context ?? context),
    runIdBindsToolAuthorization: context.runIdBindsToolAuthorization,
  };

  try {
    sessionManager.startRun({ runId, threadId });
  } catch (error) {
    if (error instanceof RunAlreadyExistsError) {
      return Response.json({ error: "Run already active" }, { status: 409 });
    }
    throw error;
  }

  // Only a step-only ceiling reaches here: a tool allowlist refuses the
  // injected-tools path outright, so this narrows the step budget without
  // touching the merged client tool surface.
  const restrictedConfig = hasAgUiRuntimeRestrictions(restrictions)
    ? applyAgUiRuntimeRestrictionsForModel(agent.config, restrictions, request.model, agent.id)
    : agent.config;
  const runtime = new AgentRuntime(agent.id, {
    ...restrictedConfig,
    tools: buildMergedAgUiTools(agent, runId, request.tools, sessionManager),
  });
  // A ceiling-bound run must not reach the model through the mutable
  // `AgentRuntime.prototype.stream`: project code can replace that method and
  // run outside the narrowed configuration, so the restricted run dispatches
  // through the framework-owned private capability instead. An unrestricted
  // run keeps the public method, which stays available as an extension seam.
  const streamRun: (
    ...args: Parameters<AgentRuntime["stream"]>
  ) => Promise<ReadableStream<Uint8Array>> = hasAgUiRuntimeRestrictions(restrictions)
    ? (...args) => streamWithAgentRuntimeDispatch(runtime, ...args)
    : (...args) => runtime.stream(...args);

  let upstreamBody: ReadableStream<Uint8Array>;
  let completedResponse: AgentResponse | null = null;
  const toolDataEvents = createToolDataEventBridge();
  try {
    upstreamBody = await streamRun(
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
    onComplete: onComplete
      ? (response) =>
        onComplete({
          agentId: agent.id,
          threadId,
          runId,
          messages: response.messages,
          inputMessages: messages,
          response,
        })
      : undefined,
  });
}

/** Options accepted by AG-UI handler. */
export interface AgUiHandlerOptions {
  context?:
    | Record<string, unknown>
    | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);
  sessionManager?: RunResumeSessionManager<AgUiResumeValue>;
  beforeStream?: AgUiBeforeStream;
  /**
   * Called once after a successful run with the finalized conversation, so an
   * application can persist it server-side. See {@link AgUiOnComplete} for the
   * success / error / disconnect semantics.
   */
  onComplete?: AgUiOnComplete;
  /**
   * Trusted per-run ceiling for the agent's tools and step budget, set by a
   * server caller that resolved it itself (control-plane eval execution). It
   * only narrows the agent configuration; a request can never widen it.
   *
   * A restricted run streams through the agent's configuration rather than its
   * own `stream()` implementation, so the ceiling binds tool exposure and
   * execution.
   */
  runtimeRestrictions?: AgUiRuntimeRestrictions;
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
    const applicationRequest = createApplicationRequest(request);

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
      const parsed = await parseAgUiRequestOrError(applicationRequest);
      if (isResponseLike(parsed)) {
        return parsed;
      }

      if (parsed.tools.length > 0) {
        if (options?.runtimeRestrictions?.allowedTools !== undefined) {
          // The injected-tools path merges client tool definitions into the
          // agent runtime, so those tools would run outside a tool allowlist.
          // Refuse the run rather than execute it outside the ceiling. A
          // step-only ceiling has no allowlist to bypass, so it still runs and
          // the bound is applied to the merged runtime below.
          return Response.json(
            {
              error: "Injected AG-UI tools are not available on a restricted AG-UI run.",
            },
            { status: 400 },
          );
        }

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
          ? await options.context(applicationRequest)
          : options?.context ?? {};

        return await createAgUiInjectedToolsStreamResponse(
          agent,
          parsed,
          applicationRequest,
          context,
          options.sessionManager,
          options?.beforeStream,
          options?.onComplete,
          options?.runtimeRestrictions,
        );
      }

      const context = typeof options?.context === "function"
        ? await options.context(applicationRequest)
        : options?.context ?? {};

      return await createAgUiDirectStreamResponse(
        agent,
        parsed,
        applicationRequest,
        context,
        options?.beforeStream,
        options?.onComplete,
        options?.runtimeRestrictions,
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
