import {
  type Agent,
  type AgentMessage as Message,
  type AgentResponse,
  AgentRuntime,
} from "#veryfront/agent";
import { normalizeAgUiRuntimeMessages } from "#veryfront/agent/ag-ui-runtime-support.ts";
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
import { serverLogger } from "#veryfront/utils";

const anyObjectSchema = z.record(z.string(), z.unknown());
const logger = serverLogger.component("internal-agent-run-stream");

type RuntimeFilteredAgent = Agent & {
  config: Agent["config"] & {
    __vfAllowedRemoteTools?: string[];
    __vfForwardedIntegrationToolDefs?: ForwardedToolDef[];
  };
};

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
      modelOverride?: string,
      maxOutputTokensOverride?: number,
      abortSignal?: AbortSignal,
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

      sessionManager.prepareForToolResult(runId, toolCallId);
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

function getAllowedRemoteToolNames(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): string[] | undefined {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides || !Object.hasOwn(runtimeOverrides, "allowedTools")) {
    return undefined;
  }
  const allowedTools = runtimeOverrides.allowedTools;
  if (!Array.isArray(allowedTools)) {
    return [];
  }
  return allowedTools.every((toolName) => typeof toolName === "string") ? allowedTools : [];
}

interface ForwardedToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

function getForwardedIntegrationToolDefinitions(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): ForwardedToolDef[] | undefined {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides) return undefined;
  const defs = runtimeOverrides.integrationToolDefinitions;
  if (!Array.isArray(defs) || defs.length === 0) return undefined;
  return defs.filter(
    (def): def is ForwardedToolDef =>
      typeof def === "object" &&
      def !== null &&
      typeof def.name === "string" &&
      typeof def.description === "string",
  ).map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.inputSchema ?? def.parameters ?? { type: "object", properties: {} },
  }));
}

export async function createRuntimeAgentStreamResponse(
  input: RuntimeRunAgentInput,
  agent: Agent,
  deps: RuntimeAgentStreamExecutionDeps,
): Promise<Response> {
  logger.info("Starting internal agent runtime stream", {
    runId: input.runId,
    threadId: input.threadId,
    agentId: agent.id,
    messageCount: input.messages.length,
    toolCount: input.tools.length,
    contextCount: input.context.length,
  });
  const abortSignal = deps.sessionManager.startRun({
    runId: input.runId,
    threadId: input.threadId,
  });

  const mergedTools = buildMergedTools(agent, input, deps.sessionManager);
  const allowedRemoteToolNames = getAllowedRemoteToolNames(input.forwardedProps);
  const forwardedIntegrationToolDefs = getForwardedIntegrationToolDefinitions(input.forwardedProps);
  const runtimeAgent: RuntimeFilteredAgent = {
    ...agent,
    config: {
      ...agent.config,
      tools: mergedTools,
      ...(allowedRemoteToolNames !== undefined
        ? { __vfAllowedRemoteTools: allowedRemoteToolNames }
        : {}),
      ...(forwardedIntegrationToolDefs !== undefined
        ? { __vfForwardedIntegrationToolDefs: forwardedIntegrationToolDefs }
        : {}),
    },
  };
  const runtime = deps.createRuntime?.(runtimeAgent, mergedTools) ??
    new AgentRuntime(runtimeAgent.id, runtimeAgent.config);

  let completedResponse: AgentResponse | null = null;
  const runtimeMessages = normalizeAgUiRuntimeMessages(input.messages);
  let runtimeStream: ReadableStream<Uint8Array>;
  let clientAttached = true;
  try {
    runtimeStream = await runtime.stream(
      runtimeMessages,
      {
        threadId: input.threadId,
        runId: input.runId,
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        context: input.context,
        forwardedProps: input.forwardedProps,
      },
      {
        onFinish: (response) => {
          completedResponse = response;
        },
      },
      undefined,
      undefined,
      abortSignal,
    );
    logger.info("Internal agent runtime stream attached", {
      runId: input.runId,
      threadId: input.threadId,
      agentId: agent.id,
    });
  } catch (error) {
    deps.sessionManager.failRun(input.runId);
    logger.error("Internal agent runtime stream setup failed", {
      runId: input.runId,
      threadId: input.threadId,
      agentId: agent.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const response = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const state = createStreamTransformState();
      const reader = runtimeStream.getReader();
      const decoder = new TextDecoder();
      let remainder = "";
      let aborted = false;

      const enqueueIfAttached = (event: string, payload: Record<string, unknown>) => {
        const encodedEvent = formatAgUiEvent(event, payload);
        if (!clientAttached) {
          return;
        }

        try {
          controller.enqueue(encodedEvent);
        } catch {
          clientAttached = false;
        }
      };
      const prepareToolResultIfNeeded = (event: string, payload: Record<string, unknown>) => {
        if (
          event !== "ToolCallStart" && event !== "ToolCallArgs" &&
          event !== "ToolCallEnd"
        ) {
          return;
        }

        const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : null;
        if (!toolCallId) {
          return;
        }

        deps.sessionManager.prepareForToolResult(input.runId, toolCallId);
      };

      const throwIfAborted = () => {
        if (aborted || abortSignal.aborted) {
          throw new AgentRunCancelledError();
        }
      };

      const abortHandler = () => {
        aborted = true;
        logger.warn("Internal agent runtime stream aborted", {
          runId: input.runId,
          threadId: input.threadId,
          agentId: agent.id,
        });
        reader.cancel(new AgentRunCancelledError()).catch(() => {});
      };

      abortSignal.addEventListener("abort", abortHandler, { once: true });
      enqueueIfAttached("RunStarted", {
        runId: input.runId,
        threadId: input.threadId,
        agentId: agent.id,
      });

      try {
        while (true) {
          throwIfAborted();

          const { done, value } = await reader.read();
          throwIfAborted();

          if (done) {
            logger.info("Internal agent runtime stream reader completed", {
              runId: input.runId,
              threadId: input.threadId,
              agentId: agent.id,
            });
            break;
          }

          remainder += decoder.decode(value, { stream: true });
          const parsed = parseSseJsonEvents(remainder);
          remainder = parsed.remainder;

          for (const event of parsed.events) {
            for (const mappedEvent of mapRuntimeEventToAgUi(state, event)) {
              prepareToolResultIfNeeded(mappedEvent.event, mappedEvent.payload);
              enqueueIfAttached(mappedEvent.event, mappedEvent.payload);
            }
          }
        }

        throwIfAborted();

        const trailingEvents = parseSseJsonEvents(`${remainder}\n\n`);
        for (const event of trailingEvents.events) {
          for (const mappedEvent of mapRuntimeEventToAgUi(state, event)) {
            prepareToolResultIfNeeded(mappedEvent.event, mappedEvent.payload);
            enqueueIfAttached(mappedEvent.event, mappedEvent.payload);
          }
        }

        throwIfAborted();

        for (const mappedEvent of finalizeRunEvents(state, completedResponse)) {
          enqueueIfAttached(mappedEvent.event, mappedEvent.payload);
        }
        deps.sessionManager.completeRun(input.runId);
        logger.info("Internal agent runtime stream finalized", {
          runId: input.runId,
          threadId: input.threadId,
          agentId: agent.id,
          sawVisibleOutput: state.sawVisibleOutput,
          sawTerminalError: state.sawTerminalError,
          finishReason: state.metadata.finishReason,
        });
      } catch (error) {
        if (error instanceof AgentRunCancelledError) {
          deps.sessionManager.cancelRun(input.runId);
          logger.warn("Internal agent runtime stream cancelled", {
            runId: input.runId,
            threadId: input.threadId,
            agentId: agent.id,
            error: error.message,
          });
          enqueueIfAttached("RunError", {
            code: "CANCELLED",
            message: error.message,
          });
        } else {
          deps.sessionManager.failRun(input.runId);
          logger.error("Internal agent runtime stream failed", {
            runId: input.runId,
            threadId: input.threadId,
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error),
          });
          enqueueIfAttached("RunError", {
            code: "RUNTIME_ERROR",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        abortSignal.removeEventListener("abort", abortHandler);
        if (clientAttached) {
          controller.close();
        }
        logger.debug("Internal agent runtime stream response closed", {
          runId: input.runId,
          threadId: input.threadId,
          agentId: agent.id,
          clientAttached,
        });
      }
    },
    cancel() {
      clientAttached = false;
      logger.info("Internal agent runtime client detached", {
        runId: input.runId,
        threadId: input.threadId,
        agentId: agent.id,
      });
      return Promise.resolve();
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
