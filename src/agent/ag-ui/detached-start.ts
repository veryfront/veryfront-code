import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { streamDataStreamEvents } from "../streaming/data-stream.ts";
import { getAgUiRequestSchema, normalizeAgUiMessages } from "./host-support.ts";
import { extractRequest } from "./request-shared.ts";
import { type AgUiResumeValue, buildMergedAgUiTools } from "./tool-shared.ts";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
} from "../runtime/index.ts";
import type { Agent } from "../types.ts";
import type { ChatUiMessage, MessageMetadata } from "#veryfront/chat/types.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const getAgUiDetachedRunIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(AGENT_ID_PATTERN)
);

type AgUiContextValue =
  | Record<string, unknown>
  | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);

type AgUiRuntimePart = Record<string, unknown> & { type: string };

function buildStreamContext(
  request: AgUiDetachedStartRequest,
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

function buildMergedTools(
  agent: Agent,
  request: AgUiDetachedStartRequest,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Agent["config"]["tools"] {
  return buildMergedAgUiTools(agent, request.runId, request.tools, sessionManager);
}

function scheduleDetachedTask(requestOrCtx: unknown, task: Promise<void>): void {
  if (
    typeof requestOrCtx === "object" &&
    requestOrCtx !== null &&
    "waitUntil" in requestOrCtx &&
    typeof (requestOrCtx as Record<string, unknown>).waitUntil === "function"
  ) {
    ((requestOrCtx as { waitUntil: (promise: Promise<void>) => void }).waitUntil)(task);
    return;
  }

  void task;
}

async function drainRuntimeStream(
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  for await (const _event of streamDataStreamEvents(stream) as AsyncIterable<AgUiRuntimePart>) {
    continue;
  }
}

export const getAgUiDetachedStartRequestSchema = defineSchema((v) =>
  getAgUiRequestSchema().extend({
    threadId: v.string().uuid(),
    runId: getAgUiDetachedRunIdSchema(),
  })
);

export const getAgUiDetachedStartAcceptedSchema = defineSchema((v) =>
  v.object({
    accepted: v.literal(true),
    duplicate: v.boolean(),
    runId: getAgUiDetachedRunIdSchema(),
    threadId: v.string().uuid(),
  })
);

/** @deprecated Use getAgUiDetachedStartRequestSchema() */
export const AgUiDetachedStartRequestSchema = lazySchema(getAgUiDetachedStartRequestSchema);
/** @deprecated Use getAgUiDetachedStartAcceptedSchema() */
export const AgUiDetachedStartAcceptedSchema = lazySchema(getAgUiDetachedStartAcceptedSchema);

export type AgUiDetachedStartRequest = InferSchema<
  ReturnType<typeof getAgUiDetachedStartRequestSchema>
>;
export type AgUiDetachedStartAccepted = InferSchema<
  ReturnType<typeof getAgUiDetachedStartAcceptedSchema>
>;

function toDetachedAgUiMessageMetadata(
  metadata: MessageMetadata | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const normalizedMetadata: Record<string, unknown> = {
    ...(metadata.modelId ? { modelId: metadata.modelId } : {}),
    ...(metadata.usage
      ? {
        usage: {
          ...(metadata.usage.inputTokens !== undefined
            ? { inputTokens: metadata.usage.inputTokens }
            : {}),
          ...(metadata.usage.outputTokens !== undefined
            ? { outputTokens: metadata.usage.outputTokens }
            : {}),
          ...(metadata.usage.cachedInputTokens !== undefined
            ? { cachedInputTokens: metadata.usage.cachedInputTokens }
            : {}),
        },
      }
      : {}),
  };

  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : undefined;
}

export function buildDetachedAgUiStartRequest(input: {
  runId: string;
  threadId: string;
  messages: ChatUiMessage[];
  model?: string;
  forwardedProps?: Record<string, unknown>;
  createThreadId?: () => string;
}): AgUiDetachedStartRequest {
  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(input.threadId);
  const effectiveThreadId = isValidUuid
    ? input.threadId
    : (input.createThreadId?.() ?? crypto.randomUUID());
  const effectiveMessages: AgUiDetachedStartRequest["messages"] = input.messages.length > 0
    ? input.messages.map((message) => {
      const metadata = toDetachedAgUiMessageMetadata(message.metadata);

      return {
        id: message.id,
        role: message.role,
        parts: message.parts,
        ...(metadata ? { metadata } : {}),
      };
    })
    : [
      {
        id: `${input.runId}:placeholder`,
        role: "user",
        parts: [{ type: "text", text: "" }],
      },
    ];

  return {
    runId: input.runId,
    threadId: effectiveThreadId,
    messages: effectiveMessages,
    tools: [],
    context: [],
    ...(input.model ? { model: input.model } : {}),
    ...(input.forwardedProps ? { forwardedProps: input.forwardedProps } : {}),
  };
}

export interface ExecuteAgUiDetachedStartInput {
  request: AgUiDetachedStartRequest;
  rawRequest?: Request;
  requestOrCtx?: unknown;
  context?: Record<string, unknown>;
}

interface AgUiDetachedStartExecutionInput {
  request: AgUiDetachedStartRequest;
  requestOrCtx: unknown;
  rawRequest: Request;
  context: Record<string, unknown>;
  abortSignal: AbortSignal;
}

type AgUiDetachedExecutionStarter = (
  input: AgUiDetachedStartExecutionInput,
) => Promise<void> | void;

interface AgUiDetachedStartHandlerOptionsBase {
  sessionManager: RunResumeSessionManager<AgUiResumeValue>;
  context?: AgUiContextValue;
  startDetachedExecution?: AgUiDetachedExecutionStarter;
  onAccepted?: (input: {
    request: AgUiDetachedStartRequest;
    runId: string;
    threadId: string;
  }) => Promise<void> | void;
  onDuplicate?: (input: {
    request: AgUiDetachedStartRequest;
    runId: string;
    threadId: string;
  }) => Promise<void> | void;
  onFinish?: (input: { runId: string; threadId: string }) => Promise<void> | void;
  onError?: (input: { runId: string; threadId: string; error: unknown }) => Promise<void> | void;
}

export type AgUiDetachedStartHandlerOptions =
  | (AgUiDetachedStartHandlerOptionsBase & { agent: Agent })
  | (AgUiDetachedStartHandlerOptionsBase & {
    agent?: undefined;
    startDetachedExecution: AgUiDetachedExecutionStarter;
  });

async function startDefaultDetachedExecution(input: {
  agent: Agent;
  request: AgUiDetachedStartRequest;
  context: Record<string, unknown>;
  abortSignal: AbortSignal;
  sessionManager: RunResumeSessionManager<AgUiResumeValue>;
}): Promise<void> {
  const runtime = new AgentRuntime(input.agent.id, {
    ...input.agent.config,
    tools: buildMergedTools(input.agent, input.request, input.sessionManager),
  });

  const runtimeStream = await runtime.stream(
    normalizeAgUiMessages(input.request.messages),
    buildStreamContext(input.request, input.context, input.request.threadId, input.request.runId),
    undefined,
    input.request.model,
    input.request.maxOutputTokens,
    input.abortSignal,
  );

  await drainRuntimeStream(runtimeStream);
}

async function resolveDetachedStartContext(
  options: AgUiDetachedStartHandlerOptions,
  input: ExecuteAgUiDetachedStartInput,
): Promise<Record<string, unknown>> {
  if (input.context) {
    return input.context;
  }

  if (!options.context) {
    return {};
  }

  if (typeof options.context === "function") {
    if (!input.rawRequest) {
      throw INVALID_ARGUMENT.create({
        detail: "executeAgUiDetachedStart requires rawRequest when options.context is a function.",
      });
    }

    return await options.context(input.rawRequest);
  }

  return options.context;
}

function assertDetachedStartRawRequest(
  options: AgUiDetachedStartHandlerOptions,
  input: ExecuteAgUiDetachedStartInput,
): Request | undefined {
  if (!options.startDetachedExecution) {
    return input.rawRequest;
  }

  if (input.rawRequest) {
    return input.rawRequest;
  }

  throw INVALID_ARGUMENT.create({
    detail:
      "executeAgUiDetachedStart requires rawRequest when options.startDetachedExecution is used.",
  });
}

export async function executeAgUiDetachedStart(
  options: AgUiDetachedStartHandlerOptions,
  input: ExecuteAgUiDetachedStartInput,
): Promise<Response> {
  const rawRequest = assertDetachedStartRawRequest(options, input);
  const context = await resolveDetachedStartContext(options, input);

  try {
    const abortSignal = options.sessionManager.startRun({
      runId: input.request.runId,
      threadId: input.request.threadId,
    });

    await options.onAccepted?.({
      request: input.request,
      runId: input.request.runId,
      threadId: input.request.threadId,
    });

    const detachedTask = (async () => {
      try {
        if (options.startDetachedExecution) {
          await options.startDetachedExecution({
            request: input.request,
            requestOrCtx: input.requestOrCtx,
            rawRequest: rawRequest!,
            context,
            abortSignal,
          });
        } else if (options.agent) {
          await startDefaultDetachedExecution({
            agent: options.agent,
            request: input.request,
            context,
            abortSignal,
            sessionManager: options.sessionManager,
          });
        } else {
          throw new Error(
            "Detached AG-UI start configuration became invalid during execution.",
          );
        }

        options.sessionManager.completeRun(input.request.runId);
        await options.onFinish?.({
          runId: input.request.runId,
          threadId: input.request.threadId,
        });
      } catch (error) {
        options.sessionManager.failRun(input.request.runId);
        await options.onError?.({
          runId: input.request.runId,
          threadId: input.request.threadId,
          error,
        });
      }
    })().catch(() => undefined);

    scheduleDetachedTask(input.requestOrCtx, detachedTask);

    return Response.json(
      {
        accepted: true,
        duplicate: false,
        runId: input.request.runId,
        threadId: input.request.threadId,
      } satisfies AgUiDetachedStartAccepted,
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof RunAlreadyExistsError) {
      await options.onDuplicate?.({
        request: input.request,
        runId: input.request.runId,
        threadId: input.request.threadId,
      });

      return Response.json(
        {
          accepted: true,
          duplicate: true,
          runId: input.request.runId,
          threadId: input.request.threadId,
        } satisfies AgUiDetachedStartAccepted,
        { status: 202 },
      );
    }

    options.sessionManager.failRun(input.request.runId);
    throw error;
  }
}

export function createAgUiDetachedStartHandler(
  options: AgUiDetachedStartHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response> {
  if (!options.agent && !options.startDetachedExecution) {
    throw new Error(
      "Detached AG-UI start requires either an agent or startDetachedExecution handler.",
    );
  }

  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);

    try {
      const parsed = getAgUiDetachedStartRequestSchema().parse(await request.json());
      return await executeAgUiDetachedStart(options, {
        request: parsed,
        rawRequest: request,
        requestOrCtx,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "issues" in error &&
        Array.isArray((error as Record<string, unknown>).issues)
      ) {
        const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
        return Response.json(
          {
            error: "Invalid AG-UI detached start request",
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
          error: error instanceof Error ? error.message : "Internal detached start failed",
        },
        { status: 500 },
      );
    }
  };
}
