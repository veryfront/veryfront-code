import {
  type Agent,
  type AgentMessage as Message,
  type AgentResponse,
  AgentRuntime,
} from "#veryfront/agent";
import { normalizeAgUiRuntimeMessages } from "#veryfront/agent/ag-ui/runtime-support.ts";
import { compactForStep, estimateOverhead } from "#veryfront/chat/message-prep.ts";
import type { RuntimeRemoteToolConfig } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import {
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
} from "#veryfront/agent/runtime/message-adapter.ts";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
} from "#veryfront/sandbox";
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  type SandboxShellToolsProvider,
  SandboxShellToolsProviderName,
} from "#veryfront/extensions/sandbox/index.ts";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { isToolVisibleTo, type Tool, toolRegistry } from "#veryfront/tool";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
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

const getAnyObjectSchema = defineSchema((v) => v.record(v.string(), v.unknown()));
const anyObjectSchema = lazySchema(getAnyObjectSchema) as Schema<Record<string, unknown>>;
const logger = serverLogger.component("internal-agent-run-stream");
const PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME = "bash";
const INTERNAL_AGENT_RUNTIME_HEARTBEAT_INTERVAL_MS = 25_000;
const INTERNAL_AGENT_RUNTIME_HEARTBEAT_FRAME = new TextEncoder().encode(
  ": internal-agent-runtime-heartbeat\n\n",
);

type RuntimeFilteredAgent = Agent & {
  config: Agent["config"] & {
    __vfForwardedIntegrationToolDefs?: ForwardedToolDef[];
  } & RuntimeRemoteToolConfig;
};

function getAgentAllowedRemoteToolNames(agent: Agent): string[] {
  const raw = (agent.config as Agent["config"] & RuntimeRemoteToolConfig).__vfAllowedRemoteTools;
  return Array.isArray(raw) && raw.every((toolName) => typeof toolName === "string") ? raw : [];
}

function mergeRemoteToolNames(source: string[], forwarded: string[]): string[] {
  const merged = new Set<string>();
  for (const toolName of source) {
    merged.add(toolName);
  }
  for (const toolName of forwarded) {
    merged.add(toolName);
  }
  return [...merged];
}

export interface RuntimeAgentStreamExecutionDeps {
  sessionManager: AgentRunSessionManager;
  projectAgentSandbox?: {
    apiUrl?: string;
    authToken?: string;
    projectId?: string | null;
    sandboxEndpoint?: string;
  };
  createBashTool?: AgentServiceSandboxToolsOptions["createBashTool"];
  createAgentServiceSandboxTools?: (
    input: AgentServiceSandboxToolsOptions,
  ) => Promise<AgentServiceSandboxToolsResult>;
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

export function buildMergedTools(
  agent: Agent,
  input: RuntimeRunAgentInput,
  sessionManager: AgentRunSessionManager,
  availableForwardedToolNames?: string[],
  availableLocalTools?: Record<string, Tool | boolean>,
) {
  const serverResolvedProjectToolNames = getServerResolvedProjectToolNames(input.forwardedProps);
  const concreteSourceToolNames = agent.config.tools && agent.config.tools !== true
    ? new Set(
      Object.entries(agent.config.tools)
        .filter(([, entry]) => entry && typeof entry === "object")
        .map(([toolName]) => toolName),
    )
    : new Set<string>();
  const injectedTools = Object.fromEntries(
    input.tools
      .filter((tool) =>
        !concreteSourceToolNames.has(tool.name) &&
        !serverResolvedProjectToolNames.has(tool.name)
      )
      .map((tool) => [
        tool.name,
        createInjectedStudioTool(
          input.runId,
          tool.name,
          tool.description,
          tool.inputSchema ?? tool.parameters,
          sessionManager,
        ),
      ]),
  );

  if (!agent.config.tools) {
    return Object.keys(injectedTools).length ? injectedTools : undefined;
  }

  const sourceAllowedRemoteToolNames = getAgentAllowedRemoteToolNames(agent);

  if (agent.config.tools === true) {
    const merged: Record<string, Tool | boolean> = {};
    for (const [toolId, registryTool] of toolRegistry.getAll()) {
      if (!agent.config.skills && SKILL_TOOL_IDS.has(toolId)) {
        continue;
      }
      // Owner-aware: another agent's owned tool never enters this agent's
      // model tool definitions.
      if (!isToolVisibleTo(registryTool, { agentId: agent.id })) {
        continue;
      }
      merged[toolId] = true;
    }
    for (const toolName of sourceAllowedRemoteToolNames) {
      merged[toolName] = true;
    }
    return { ...merged, ...injectedTools };
  }

  const merged: Record<string, Tool | boolean> = {};
  for (const [toolName, entry] of Object.entries(agent.config.tools)) {
    if (entry === true) {
      // Registry lookups are owner-aware: another agent's owned tool behaves
      // as if it does not exist for this agent.
      const visibleRegistryTool = (() => {
        const registryTool = toolRegistry.get(toolName);
        return registryTool && isToolVisibleTo(registryTool, { agentId: agent.id })
          ? registryTool
          : undefined;
      })();
      const serverResolvedProjectTool = serverResolvedProjectToolNames.has(toolName)
        ? visibleRegistryTool
        : undefined;
      if (
        serverResolvedProjectTool ||
        visibleRegistryTool ||
        availableLocalTools?.[toolName] ||
        availableForwardedToolNames?.includes(toolName) ||
        sourceAllowedRemoteToolNames.includes(toolName)
      ) {
        merged[toolName] = availableLocalTools?.[toolName] ?? serverResolvedProjectTool ?? true;
      }
      continue;
    }

    if (entry && typeof entry === "object") {
      merged[toolName] = entry;
    }
  }

  const filtered = { ...merged, ...injectedTools };
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

async function loadDefaultCreateBashTool(): Promise<
  AgentServiceSandboxToolsOptions["createBashTool"]
> {
  const provider = tryResolve<SandboxShellToolsProvider>(SandboxShellToolsProviderName);
  if (provider) return provider;

  const { createBashSandboxShellToolsProvider } = await import(
    "../../extensions/ext-sandbox-shell-tools/src/index.ts"
  );
  return createBashSandboxShellToolsProvider;
}

function getStringProperty(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function getAgentSandboxConfig(
  agent: Agent,
): { sandboxId?: string; sandboxEndpoint?: string; projectId?: string } {
  const config = agent.config as Agent["config"] & { sandbox?: unknown };
  if (!isRecord(config.sandbox)) {
    return {};
  }

  return {
    sandboxId: getStringProperty(config.sandbox, ["id", "sandboxId", "sessionId"]),
    sandboxEndpoint: getStringProperty(config.sandbox, ["endpoint", "sandboxEndpoint"]),
    projectId: getStringProperty(config.sandbox, ["projectId"]),
  };
}

function shouldExposeSandboxBash(agent: Agent): boolean {
  const tools = agent.config.tools;
  return isRecord(tools) && tools[PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME] === true;
}

async function buildProjectAgentSandboxTools(input: {
  agent: Agent;
  deps: RuntimeAgentStreamExecutionDeps;
}): Promise<{ tools?: Record<string, Tool | boolean>; closeSandbox?: () => Promise<void> }> {
  if (!shouldExposeSandboxBash(input.agent)) {
    return {};
  }

  const sandboxConfig = getAgentSandboxConfig(input.agent);
  const createBashTool = input.deps.createBashTool ?? await loadDefaultCreateBashTool();
  const createSandboxTools = input.deps.createAgentServiceSandboxTools ??
    createAgentServiceSandboxTools;
  const sandboxResult = await createSandboxTools({
    createBashTool,
    ...(input.deps.projectAgentSandbox?.apiUrl
      ? { apiUrl: input.deps.projectAgentSandbox.apiUrl }
      : {}),
    ...(input.deps.projectAgentSandbox?.authToken
      ? { authToken: input.deps.projectAgentSandbox.authToken }
      : {}),
    ...(sandboxConfig.sandboxId
      ? { sandboxId: sandboxConfig.sandboxId, deleteOnClose: false }
      : {}),
    ...(sandboxConfig.sandboxEndpoint ?? input.deps.projectAgentSandbox?.sandboxEndpoint
      ? {
        sandboxEndpoint: sandboxConfig.sandboxEndpoint ??
          input.deps.projectAgentSandbox?.sandboxEndpoint,
      }
      : {}),
    getProjectId: () => sandboxConfig.projectId ?? input.deps.projectAgentSandbox?.projectId,
  });

  const bash = sandboxResult.tools[PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME];
  if (!bash) {
    await sandboxResult.closeSandbox();
    return {};
  }

  return {
    tools: {
      [PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME]: bash as Tool,
    },
    closeSandbox: sandboxResult.closeSandbox,
  };
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

function getServerResolvedProjectToolNames(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): Set<string> {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides) return new Set();
  const toolNames = runtimeOverrides.serverResolvedProjectTools;
  if (!Array.isArray(toolNames)) return new Set();
  return new Set(
    toolNames.filter((toolName): toolName is string =>
      typeof toolName === "string" && toolName.length > 0
    ),
  );
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

function compactRuntimeMessagesForStream(
  messages: Message[],
  mergedTools: Agent["config"]["tools"],
): Message[] {
  const toolCount = mergedTools && mergedTools !== true ? Object.keys(mergedTools).length : 0;
  return convertProviderMessagesToAgentRuntimeMessages(
    compactForStep(
      convertAgentRuntimeMessagesToProviderMessages(messages),
      estimateOverhead("", toolCount),
    ),
  ) as Message[];
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

  const forwardedAllowedRemoteToolNames = getAllowedRemoteToolNames(input.forwardedProps);
  const sourceAllowedRemoteToolNames = getAgentAllowedRemoteToolNames(agent);
  const allowedRemoteToolNames = forwardedAllowedRemoteToolNames === undefined
    ? undefined
    : mergeRemoteToolNames(
      sourceAllowedRemoteToolNames,
      forwardedAllowedRemoteToolNames,
    );
  const forwardedIntegrationToolDefs = getForwardedIntegrationToolDefinitions(input.forwardedProps);
  const availableForwardedToolNames = forwardedIntegrationToolDefs?.map((tool) => tool.name);
  const sandboxTools = await buildProjectAgentSandboxTools({ agent, deps });
  const mergedTools = buildMergedTools(
    agent,
    input,
    deps.sessionManager,
    availableForwardedToolNames,
    sandboxTools.tools,
  );
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
  const runtimeMessages = compactRuntimeMessagesForStream(
    normalizeAgUiRuntimeMessages(input.messages),
    mergedTools,
  );
  let runtimeStream: ReadableStream<Uint8Array>;
  let clientAttached = true;
  try {
    runtimeStream = await runtime.stream(
      runtimeMessages,
      {
        threadId: input.threadId,
        runId: input.runId,
        ...(deps.projectAgentSandbox?.authToken
          ? { authToken: deps.projectAgentSandbox.authToken }
          : {}),
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
    await sandboxTools.closeSandbox?.().catch((cleanupError) => {
      logger.warn("Internal agent runtime sandbox cleanup failed after setup error", {
        runId: input.runId,
        agentId: agent.id,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    logger.error("Internal agent runtime stream setup failed", {
      runId: input.runId,
      threadId: input.threadId,
      agentId: agent.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  let stopHeartbeat: (() => void) | undefined;
  const response = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const state = createStreamTransformState();
      const reader = runtimeStream.getReader();
      const decoder = new TextDecoder();
      let remainder = "";
      let aborted = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
      };

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
      const enqueueHeartbeatIfAttached = () => {
        if (!clientAttached) {
          return;
        }

        try {
          controller.enqueue(INTERNAL_AGENT_RUNTIME_HEARTBEAT_FRAME);
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
        reader.cancel(new AgentRunCancelledError()).catch((error) => {
          logger.debug("Internal agent runtime reader cancellation failed during abort cleanup", {
            runId: input.runId,
            threadId: input.threadId,
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      };

      abortSignal.addEventListener("abort", abortHandler, { once: true });
      enqueueIfAttached("RunStarted", {
        runId: input.runId,
        threadId: input.threadId,
        agentId: agent.id,
      });
      heartbeatTimer = setInterval(
        enqueueHeartbeatIfAttached,
        INTERNAL_AGENT_RUNTIME_HEARTBEAT_INTERVAL_MS,
      );

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
        stopHeartbeat?.();
        stopHeartbeat = undefined;
        abortSignal.removeEventListener("abort", abortHandler);
        if (clientAttached) {
          controller.close();
        }
        await sandboxTools.closeSandbox?.().catch((cleanupError) => {
          logger.warn("Internal agent runtime sandbox cleanup failed", {
            runId: input.runId,
            agentId: agent.id,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        });
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
      stopHeartbeat?.();
      stopHeartbeat = undefined;
      const status = deps.sessionManager.getRunStatus(input.runId);
      const shouldCancelActiveRun = status !== null && status !== "waiting";
      if (shouldCancelActiveRun) {
        deps.sessionManager.cancelRun(input.runId);
      }
      logger.info("Internal agent runtime client detached", {
        runId: input.runId,
        threadId: input.threadId,
        agentId: agent.id,
        status,
        cancelledActiveRun: shouldCancelActiveRun,
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
