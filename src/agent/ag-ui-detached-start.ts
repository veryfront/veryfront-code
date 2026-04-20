import { z } from "zod";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { type Tool, toolRegistry } from "#veryfront/tool";
import { streamDataStreamEvents } from "./data-stream.ts";
import {
  type AgUiInjectedTool,
  AgUiRequestSchema,
  normalizeAgUiMessages,
} from "./ag-ui-host-support.ts";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
} from "./runtime/index.ts";
import type { Agent } from "./types.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const AG_UI_DETACHED_RUN_ID_SCHEMA = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);
type AgUiResumeValue = {
  result: unknown;
  isError: boolean;
};

type AgUiContextValue =
  | Record<string, unknown>
  | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);

type AgUiRuntimePart = Record<string, unknown> & { type: string };

function isRequest(obj: unknown): obj is Request {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "json" in obj &&
    typeof obj.json === "function" &&
    "url" in obj &&
    typeof obj.url === "string" &&
    "method" in obj &&
    typeof obj.method === "string"
  );
}

function extractRequest(requestOrCtx: unknown): Request {
  if (isRequest(requestOrCtx)) return requestOrCtx;

  if (typeof requestOrCtx === "object" && requestOrCtx !== null && "request" in requestOrCtx) {
    const candidate = (requestOrCtx as Record<string, unknown>).request;
    if (isRequest(candidate)) return candidate;
  }

  throw INVALID_ARGUMENT.create({
    detail: "Invalid handler argument: expected Request or APIContext",
  });
}

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

function createInjectedAgUiTool(
  runId: string,
  tool: AgUiInjectedTool,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Tool {
  return {
    id: tool.name,
    type: "function",
    description: tool.description ?? tool.name,
    inputSchema: z.record(z.string(), z.unknown()),
    inputSchemaJson: (tool.parameters ??
      { type: "object", properties: {}, additionalProperties: true }) as Tool["inputSchemaJson"],
    execute: async (_input, context) => {
      const toolCallId = typeof context?.toolCallId === "string" ? context.toolCallId : null;
      if (!toolCallId) {
        throw new Error(`Missing toolCallId for injected tool "${tool.name}"`);
      }

      sessionManager.prepareForSignal(runId, toolCallId);
      const submitted = await sessionManager.waitForSignal(runId, toolCallId);
      if (submitted.isError) {
        throw new Error(
          typeof submitted.result === "string"
            ? submitted.result
            : JSON.stringify(submitted.result),
        );
      }
      return submitted.result;
    },
  };
}

function buildMergedTools(
  agent: Agent,
  request: AgUiDetachedStartRequest,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Agent["config"]["tools"] {
  const injectedTools = Object.fromEntries(
    request.tools.map((tool) => [
      tool.name,
      createInjectedAgUiTool(request.runId, tool, sessionManager),
    ]),
  );

  if (!agent.config.tools) {
    return Object.keys(injectedTools).length > 0 ? injectedTools : undefined;
  }

  if (agent.config.tools === true) {
    const merged: Record<string, Tool | boolean> = {};
    for (const [toolId] of toolRegistry.getAll()) {
      if (!agent.config.skills && SKILL_TOOL_IDS.has(toolId)) {
        continue;
      }
      merged[toolId] = true;
    }
    return { ...merged, ...injectedTools };
  }

  return { ...agent.config.tools, ...injectedTools };
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

export const AgUiDetachedStartRequestSchema = AgUiRequestSchema.extend({
  threadId: z.string().uuid(),
  runId: AG_UI_DETACHED_RUN_ID_SCHEMA,
});

export const AgUiDetachedStartAcceptedSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  runId: AG_UI_DETACHED_RUN_ID_SCHEMA,
  threadId: z.string().uuid(),
});

export type AgUiDetachedStartRequest = z.infer<typeof AgUiDetachedStartRequestSchema>;
export type AgUiDetachedStartAccepted = z.infer<typeof AgUiDetachedStartAcceptedSchema>;

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

export async function executeAgUiDetachedStart(
  options: AgUiDetachedStartHandlerOptions,
  input: ExecuteAgUiDetachedStartInput,
): Promise<Response> {
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
            rawRequest: input.rawRequest ??
              new Request("http://localhost/api/ag-ui/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input.request),
              }),
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
      const parsed = AgUiDetachedStartRequestSchema.parse(await request.json());
      return await executeAgUiDetachedStart(options, {
        request: parsed,
        rawRequest: request,
        requestOrCtx,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          {
            error: "Invalid AG-UI detached start request",
            details: error.issues.map((issue) => ({
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
