import { z } from "zod";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { type Tool, toolRegistry } from "#veryfront/tool";
import { streamDataStreamEvents } from "./data-stream.ts";
import { type AgUiInjectedTool, type AgUiRequest, AgUiRequestSchema } from "./ag-ui-handler.ts";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
} from "./runtime/index.ts";
import type { Agent, Message } from "./types.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const AG_UI_DETACHED_RUN_ID_SCHEMA = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);
const MAX_TEXT_PART_LENGTH = 10_000;

type AgUiResumeValue = {
  result: unknown;
  isError: boolean;
};

type AgUiContextValue =
  | Record<string, unknown>
  | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);

type AgUiRuntimePart = Record<string, unknown> & { type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolArgs(part: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(part.args)) return part.args;
  if (isRecord(part.input)) return part.input;
  return {};
}

function normalizeMessagePart(part: Record<string, unknown>): Message["parts"][number] | null {
  if (
    part.type === "text" && typeof part.text === "string" &&
    part.text.length <= MAX_TEXT_PART_LENGTH
  ) {
    return { type: "text", text: part.text };
  }

  if (part.type === "tool_call" && typeof part.id === "string" && typeof part.name === "string") {
    return {
      type: "tool-call",
      toolCallId: part.id,
      toolName: part.name,
      args: normalizeToolArgs(part),
    };
  }

  if (
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    return {
      type: "tool-call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: normalizeToolArgs(part),
    };
  }

  if (
    typeof part.type === "string" &&
    part.type.startsWith("tool-") &&
    part.type !== "tool-result" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    return {
      type: part.type,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: normalizeToolArgs(part),
    };
  }

  if (part.type === "tool_result" && typeof part.tool_call_id === "string") {
    return {
      type: "tool-result",
      toolCallId: part.tool_call_id,
      toolName: typeof part.tool_name === "string" ? part.tool_name : "unknown",
      result: "output" in part ? part.output : undefined,
    };
  }

  if (part.type === "tool-result" && typeof part.toolCallId === "string") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: typeof part.toolName === "string" ? part.toolName : "unknown",
      result: "result" in part ? part.result : undefined,
    };
  }

  return null;
}

function normalizeMessages(messages: AgUiRequest["messages"]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts
      .map((part) => normalizeMessagePart(part))
      .filter((part): part is Message["parts"][number] => part !== null),
    ...(message.createdAt ? { timestamp: Date.parse(message.createdAt) || undefined } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  }));
}

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

async function resolveContextValue(
  value: AgUiContextValue | undefined,
  request: Request,
): Promise<Record<string, unknown>> {
  if (typeof value === "function") {
    return await value(request);
  }

  return value ?? {};
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

export interface AgUiDetachedStartHandlerOptions {
  agent: Agent;
  sessionManager: RunResumeSessionManager<AgUiResumeValue>;
  context?: AgUiContextValue;
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

export function createAgUiDetachedStartHandler(
  options: AgUiDetachedStartHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response> {
  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);

    try {
      const parsed = AgUiDetachedStartRequestSchema.parse(await request.json());
      const context = await resolveContextValue(options.context, request);

      try {
        const abortSignal = options.sessionManager.startRun({
          runId: parsed.runId,
          threadId: parsed.threadId,
        });

        const runtime = new AgentRuntime(options.agent.id, {
          ...options.agent.config,
          tools: buildMergedTools(options.agent, parsed, options.sessionManager),
        });

        const runtimeStream = await runtime.stream(
          normalizeMessages(parsed.messages),
          buildStreamContext(parsed, context, parsed.threadId, parsed.runId),
          undefined,
          parsed.model,
          parsed.maxOutputTokens,
          abortSignal,
        );

        await options.onAccepted?.({
          request: parsed,
          runId: parsed.runId,
          threadId: parsed.threadId,
        });

        const detachedTask = (async () => {
          try {
            await drainRuntimeStream(runtimeStream);
            options.sessionManager.completeRun(parsed.runId);
            await options.onFinish?.({
              runId: parsed.runId,
              threadId: parsed.threadId,
            });
          } catch (error) {
            options.sessionManager.failRun(parsed.runId);
            await options.onError?.({
              runId: parsed.runId,
              threadId: parsed.threadId,
              error,
            });
          }
        })().catch(() => undefined);

        scheduleDetachedTask(requestOrCtx, detachedTask);

        return Response.json(
          {
            accepted: true,
            duplicate: false,
            runId: parsed.runId,
            threadId: parsed.threadId,
          } satisfies AgUiDetachedStartAccepted,
          { status: 202 },
        );
      } catch (error) {
        if (error instanceof RunAlreadyExistsError) {
          await options.onDuplicate?.({
            request: parsed,
            runId: parsed.runId,
            threadId: parsed.threadId,
          });

          return Response.json(
            {
              accepted: true,
              duplicate: true,
              runId: parsed.runId,
              threadId: parsed.threadId,
            } satisfies AgUiDetachedStartAccepted,
            { status: 202 },
          );
        }

        options.sessionManager.failRun(parsed.runId);
        throw error;
      }
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
