import {
  type Agent,
  type AgentMessage as Message,
  type AgentResponse,
  AgentRuntime,
} from "#veryfront/agent";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { type Tool, toolRegistry } from "#veryfront/tool";
import { z } from "zod";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
  parseSseJsonEvents,
} from "./ag-ui-sse.ts";
import { AgentRunCancelledError, type AgentRunSessionManager } from "./session-manager.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";

const anyObjectSchema = z.record(z.unknown());

export interface RuntimeAgentStreamExecutionDeps {
  sessionManager: AgentRunSessionManager;
  createRuntime?: (
    agent: Agent,
    mergedTools: Agent["config"]["tools"],
  ) => {
    stream: (
      messages: Message[],
      context?: Record<string, unknown>,
      callbacks?: {
        onFinish?: (response: AgentResponse) => void;
      },
    ) => Promise<ReadableStream<Uint8Array>>;
  };
}

function createInjectedStudioTool(
  runId: string,
  toolName: string,
  description: string | undefined,
  parameters: Record<string, unknown> | undefined,
  sessionManager: AgentRunSessionManager,
): Tool {
  return {
    id: toolName,
    type: "function",
    description: description ?? toolName,
    inputSchema: anyObjectSchema,
    inputSchemaJson: (parameters ??
      { type: "object", properties: {}, additionalProperties: true }) as Tool["inputSchemaJson"],
    execute: async (_input, context) => {
      const toolCallId = typeof context?.toolCallId === "string" ? context.toolCallId : null;
      if (!toolCallId) {
        throw new Error(`Missing toolCallId for injected tool "${toolName}"`);
      }

      const waitResult = await sessionManager.waitForToolResult(runId, toolCallId);
      if (waitResult.isError) {
        throw new Error(
          typeof waitResult.result === "string"
            ? waitResult.result
            : JSON.stringify(waitResult.result),
        );
      }
      return waitResult.result;
    },
  };
}

function buildMergedTools(
  agent: Agent,
  input: RuntimeRunAgentInput,
  sessionManager: AgentRunSessionManager,
) {
  const injectedTools = Object.fromEntries(
    input.tools.map((tool) => [
      tool.name,
      createInjectedStudioTool(
        input.runId,
        tool.name,
        tool.description,
        tool.parameters,
        sessionManager,
      ),
    ]),
  );

  if (!agent.config.tools) {
    return Object.keys(injectedTools).length ? injectedTools : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolArgs(part: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(part.args)) {
    return part.args;
  }

  if (isRecord(part.input)) {
    return part.input;
  }

  return {};
}

function normalizeMessagePart(part: Record<string, unknown>): Message["parts"][number] | null {
  if (part.type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }

  if (
    part.type === "tool_call" &&
    typeof part.id === "string" &&
    typeof part.name === "string"
  ) {
    return {
      type: `tool-${part.name}`,
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

function normalizeRuntimeMessages(messages: RuntimeRunAgentInput["messages"]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts
      .map((part) => isRecord(part) ? normalizeMessagePart(part) : null)
      .filter((part): part is Message["parts"][number] => part !== null),
    ...(message.createdAt ? { timestamp: Date.parse(message.createdAt) || undefined } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  }));
}

export async function createRuntimeAgentStreamResponse(
  input: RuntimeRunAgentInput,
  agent: Agent,
  deps: RuntimeAgentStreamExecutionDeps,
): Promise<Response> {
  const abortSignal = deps.sessionManager.startRun({
    runId: input.runId,
    threadId: input.threadId,
  });

  const mergedTools = buildMergedTools(agent, input, deps.sessionManager);
  const runtime = deps.createRuntime?.(agent, mergedTools) ?? new AgentRuntime(agent.id, {
    ...agent.config,
    tools: mergedTools,
  });

  let completedResponse: AgentResponse | null = null;
  const runtimeMessages = normalizeRuntimeMessages(input.messages);
  let runtimeStream: ReadableStream<Uint8Array>;
  try {
    runtimeStream = await runtime.stream(
      runtimeMessages,
      {
        threadId: input.threadId,
        runId: input.runId,
        context: input.context,
        forwardedProps: input.forwardedProps,
      },
      {
        onFinish: (response) => {
          completedResponse = response;
        },
      },
    );
  } catch (error) {
    deps.sessionManager.failRun(input.runId);
    throw error;
  }

  const response = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const state = createStreamTransformState();
      const reader = runtimeStream.getReader();
      const decoder = new TextDecoder();
      let remainder = "";
      let aborted = false;

      const throwIfAborted = () => {
        if (aborted || abortSignal.aborted) {
          throw new AgentRunCancelledError();
        }
      };

      const abortHandler = () => {
        aborted = true;
        reader.cancel(new AgentRunCancelledError()).catch(() => {});
      };

      abortSignal.addEventListener("abort", abortHandler, { once: true });
      controller.enqueue(
        formatAgUiEvent("RunStarted", {
          runId: input.runId,
          threadId: input.threadId,
          agentId: input.agentId,
        }),
      );

      try {
        while (true) {
          throwIfAborted();

          const { done, value } = await reader.read();
          throwIfAborted();

          if (done) {
            break;
          }

          remainder += decoder.decode(value, { stream: true });
          const parsed = parseSseJsonEvents(remainder);
          remainder = parsed.remainder;

          for (const event of parsed.events) {
            for (const mappedEvent of mapRuntimeEventToAgUi(state, event)) {
              controller.enqueue(formatAgUiEvent(mappedEvent.event, mappedEvent.payload));
            }
          }
        }

        throwIfAborted();

        const trailingEvents = parseSseJsonEvents(`${remainder}\n\n`);
        for (const event of trailingEvents.events) {
          for (const mappedEvent of mapRuntimeEventToAgUi(state, event)) {
            controller.enqueue(formatAgUiEvent(mappedEvent.event, mappedEvent.payload));
          }
        }

        throwIfAborted();

        for (const mappedEvent of finalizeRunEvents(state, completedResponse)) {
          controller.enqueue(formatAgUiEvent(mappedEvent.event, mappedEvent.payload));
        }
        deps.sessionManager.completeRun(input.runId);
      } catch (error) {
        if (error instanceof AgentRunCancelledError) {
          deps.sessionManager.cancelRun(input.runId);
          controller.enqueue(formatAgUiEvent("RunError", {
            code: "CANCELLED",
            message: error.message,
          }));
        } else {
          deps.sessionManager.failRun(input.runId);
          controller.enqueue(formatAgUiEvent("RunError", {
            code: "RUNTIME_ERROR",
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      } finally {
        abortSignal.removeEventListener("abort", abortHandler);
        controller.close();
      }
    },
    cancel() {
      deps.sessionManager.cancelRun(input.runId);
    },
  });

  return new Response(response, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
