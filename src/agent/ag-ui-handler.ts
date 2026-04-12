import { z } from "zod";
import { getAgent } from "./composition/index.ts";
import type { Agent, Message } from "./types.ts";
import {
  AgentRuntime,
  RunAlreadyExistsError,
  type RunResumeSessionManager,
} from "./runtime/index.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { type Tool, toolRegistry } from "#veryfront/tool";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
  parseSseJsonEvents,
} from "#veryfront/internal-agents/ag-ui-sse.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 65_536;
const MAX_TEXT_PART_LENGTH = 10_000;
const MAX_MESSAGES_PER_REQUEST = 100;

const encoder = new TextEncoder();

const AG_UI_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

const AgUiRunIdSchema = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);

const AgUiInjectedToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  parameters: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool parameters must be less than 16 KB" },
  ),
});

const AgUiContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    title: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  z.object({
    type: z.literal("json"),
    title: z.string().max(256).optional(),
    data: z.record(z.string(), z.unknown()).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_ITEM_BYTES),
      { message: "JSON context item must be less than 16 KB" },
    ),
  }),
  z.object({
    type: z.literal("resource"),
    title: z.string().max(256).optional(),
    uri: z.string().max(2048),
    mimeType: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES).optional(),
  }),
]);

const AgUiMessagePartSchema = z.object({ type: z.string().min(1) }).passthrough();

const AgUiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(AgUiMessagePartSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
});

export const AgUiRequestSchema = z.object({
  threadId: z.string().uuid().optional(),
  runId: AgUiRunIdSchema.optional(),
  messages: z.array(AgUiMessageSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
  tools: z.array(AgUiInjectedToolSchema).max(50).default([]),
  context: z.array(AgUiContextItemSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  forwardedProps: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
  model: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

export type AgUiInjectedTool = z.infer<typeof AgUiInjectedToolSchema>;
export type AgUiContextItem = z.infer<typeof AgUiContextItemSchema>;
export type AgUiRequest = z.infer<typeof AgUiRequestSchema>;

type AgUiRuntimePart = Record<string, unknown> & { type: string };
type AgUiResumeValue = { result: unknown; isError: boolean };

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

function generateRunId(): string {
  return `run_${crypto.randomUUID().replaceAll("-", "")}`;
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
    request: AgUiRequest;
    runId: string;
    threadId: string;
    upstreamBody: ReadableStream<Uint8Array> | null;
    upstreamStatus: number;
    upstreamStatusText?: string;
    onFinish?: () => void;
    onError?: (error: unknown) => void;
    onToolCallSeen?: (toolCallId: string) => void;
  },
): Promise<Response> {
  const {
    agentId,
    request,
    runId,
    threadId,
    upstreamBody,
    upstreamStatus,
    upstreamStatusText,
    onFinish,
    onError,
    onToolCallSeen,
  } = options;

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const state = createStreamTransformState();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let remainder = "";
      const decoder = new TextDecoder();
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

      if (!enqueueEvent(controller, "RunStarted", { runId, threadId, agentId })) {
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

        reader = upstreamBody.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          remainder += decoder.decode(value, { stream: true });
          const parsed = parseSseJsonEvents(remainder);
          remainder = parsed.remainder;

          for (const event of parsed.events as AgUiRuntimePart[]) {
            for (const mapped of mapRuntimeEventToAgUi(state, event)) {
              prepareToolResultIfNeeded(mapped.event, mapped.payload);
              if (!enqueueEvent(controller, mapped.event, mapped.payload)) {
                return;
              }
            }
          }
        }

        remainder += decoder.decode();
        const parsed = parseSseJsonEvents(remainder);
        for (const event of parsed.events as AgUiRuntimePart[]) {
          for (const mapped of mapRuntimeEventToAgUi(state, event)) {
            prepareToolResultIfNeeded(mapped.event, mapped.payload);
            if (!enqueueEvent(controller, mapped.event, mapped.payload)) {
              return;
            }
          }
        }

        for (const event of finalizeRunEvents(state, null)) {
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
        await reader?.cancel().catch(() => undefined);
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
  baseContext: Record<string, unknown>,
): Promise<Response> {
  const threadId = request.threadId ?? crypto.randomUUID();
  const runId = request.runId ?? generateRunId();

  await agent.clearMemory();

  const result = await agent.stream({
    messages: normalizeMessages(request.messages),
    context: buildStreamContext(request, baseContext, threadId, runId),
    ...(request.model ? { model: request.model } : {}),
    ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
  });

  const upstream = result.toDataStreamResponse();
  return await createAgUiStreamResponse({
    agentId: agent.id,
    request,
    runId,
    threadId,
    upstreamBody: upstream.body,
    upstreamStatus: upstream.status,
    upstreamStatusText: upstream.statusText,
  });
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

async function createAgUiInjectedToolsStreamResponse(
  agent: Agent,
  request: AgUiRequest,
  baseContext: Record<string, unknown>,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Promise<Response> {
  const threadId = request.threadId ?? crypto.randomUUID();
  const runId = request.runId ?? generateRunId();

  try {
    sessionManager.startRun({ runId, threadId });
  } catch (error) {
    if (error instanceof RunAlreadyExistsError) {
      return Response.json({ error: "Run already active" }, { status: 409 });
    }
    throw error;
  }

  const injectedTools = Object.fromEntries(
    request.tools.map((tool) => [tool.name, createInjectedAgUiTool(runId, tool, sessionManager)]),
  );

  const mergedTools: Agent["config"]["tools"] = !agent.config.tools
    ? injectedTools
    : agent.config.tools === true
    ? {
      ...Object.fromEntries(
        [...toolRegistry.getAll()]
          .filter(([toolId]) => agent.config.skills || !SKILL_TOOL_IDS.has(toolId))
          .map(([toolId]) => [toolId, true]),
      ),
      ...injectedTools,
    }
    : { ...agent.config.tools, ...injectedTools };

  const runtime = new AgentRuntime(agent.id, {
    ...agent.config,
    tools: mergedTools,
  });

  let upstreamBody: ReadableStream<Uint8Array>;
  try {
    upstreamBody = await runtime.stream(
      normalizeMessages(request.messages),
      buildStreamContext(request, baseContext, threadId, runId),
      undefined,
      request.model,
      request.maxOutputTokens,
    );
  } catch (error) {
    sessionManager.failRun(runId);
    throw error;
  }

  return await createAgUiStreamResponse({
    agentId: agent.id,
    request,
    runId,
    threadId,
    upstreamBody,
    upstreamStatus: 200,
    onFinish: () => {
      sessionManager.completeRun(runId);
    },
    onError: () => {
      sessionManager.failRun(runId);
    },
    onToolCallSeen: (toolCallId) => {
      sessionManager.prepareForSignal(runId, toolCallId);
    },
  });
}

export interface AgUiHandlerOptions {
  context?:
    | Record<string, unknown>
    | ((request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);
  sessionManager?: RunResumeSessionManager<AgUiResumeValue>;
}

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

export function createAgUiHandler(
  agentId: string,
  options?: AgUiHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response>;
export function createAgUiHandler(
  config: AgUiHandlerConfigWithAgent,
  options?: AgUiHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response>;
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
      const parsed = AgUiRequestSchema.parse(await request.json());

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
          context,
          options.sessionManager,
        );
      }

      const context = typeof options?.context === "function"
        ? await options.context(request)
        : options?.context ?? {};

      return await createAgUiDirectStreamResponse(agent, parsed, context);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          {
            error: "Invalid AG-UI request",
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
          error: error instanceof Error ? error.message : "Internal server error",
        },
        { status: 500 },
      );
    }
  };
}
