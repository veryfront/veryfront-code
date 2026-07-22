/**
 * Agent Runtime - Core execution engine
 *
 * Handles agent execution with:
 * - Multi-step reasoning (agent loop)
 * - Tool calling and execution
 * - Streaming responses
 * - Memory management
 * - Middleware execution
 *
 * @module ai/agent/runtime
 */

import {
  type AgentConfig,
  type AgentContext,
  type AgentResponse,
  type AgentStatus,
  getTextFromParts,
  type Message,
  type MessagePart,
  type ResolvedRuntimeState,
  type RuntimeReasoningOption,
  type ToolCall,
  type ToolExecutionResultRequest,
  type ToolResultPart,
} from "../types.ts";
import { ensureModelReady, type ModelRuntime, resolveModel } from "#veryfront/provider";
import { generateId } from "#veryfront/utils/id.ts";
import { detectPlatform, getPlatformCapabilities } from "#veryfront/platform/core-platform.ts";
import { createAgentMemory, type Memory } from "../memory/index.ts";
import { serverLogger } from "#veryfront/utils";
import {
  addSpanEvent,
  setActiveSpanErrorStatus as setOtelActiveSpanErrorStatus,
  setSpanAttributes,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import { setActiveSpanAttributes as setOtelActiveSpanAttributes } from "#veryfront/observability";
import { convertToTextGenerationRuntimeRequestMessages } from "./text-generation-runtime-message-converter.ts";
import { convertToolsToRuntimeTools } from "./model-tool-converter.ts";
import { getRuntimeRemoteToolSources } from "./mcp-server-tool-sources.ts";
import {
  createStreamState,
  processStream,
  type StreamingToolResult,
} from "./chat-stream-handler.ts";
import { repairToolCall } from "./repair-tool-call.ts";
import { MiddlewareChain } from "../middleware/chain.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import { isLocalModelRuntime } from "#veryfront/provider/runtime-inspection.ts";
import { generateText, streamText } from "#veryfront/runtime/runtime-bridge.ts";
import {
  captureStreamedToolCallInput,
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  createToolErrorMessage,
  createToolResultMessage,
  getProviderExecutedToolNames,
  getToolResultError,
  isRecoverablePlaceholderToolCall,
  isStreamedToolCallIncomplete,
  materializeStreamedToolCall,
  shouldContinueAfterStreamStep,
} from "./tool-result-continuation.ts";
import {
  enforceSkillPolicy,
  extractSkillId,
  extractSkillPolicy,
  extractSkillToolAvailability,
  FORM_INPUT_TOOL_ID,
  hasSubmittedFormInputResult,
  hydrateActiveSkillStateFromMessages,
  INACTIVE_SKILL_TOOL_AVAILABILITY,
  LOAD_SKILL_TOOL_ID,
  removeFormInputAfterSubmission,
  SUBMITTED_FORM_INPUT_CONTEXT_KEY,
} from "./skill-policy-enforcement.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderTools,
  getRuntimeSourceIntegrationPolicy,
} from "./runtime-tool-config.ts";
import {
  applySourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { prepareAgentRuntimeStep } from "./agent-runtime-step.ts";
import { buildStreamedAssistantMessage } from "./streamed-assistant-message.ts";

// Re-export from submodules
export { closeSSEStream, generateMessageId, sendSSE } from "./sse-utils.ts";
export {
  RunAlreadyExistsError,
  RunCancelledError,
  RunNotActiveError,
  RunResumeSessionManager,
  WaitConflictError,
  WaitNotPendingError,
} from "./resume-session.ts";
export type {
  RunResumeSessionManagerOptions,
  RunSessionStatus,
  SubmitResumeValueOutcome,
} from "./resume-session.ts";
export {
  executeConfiguredTool,
  getAvailableTools,
  isDynamicTool,
  parseToolArgs,
} from "./tool-helpers.ts";
export type { ParsedToolArgs, ToolConfigEntry } from "./tool-helpers.ts";
export {
  getProviderToolProfile,
  type ProviderToolCompatOptions,
  type ProviderToolCompatProvider,
  type ProviderToolProfile,
  sanitizeProviderToolSchema,
  selectProviderCompatibleToolNames,
  selectProviderCompatibleTools,
} from "./provider-tool-compat.ts";
export { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
export { createStreamState, processStream } from "./chat-stream-handler.ts";
export type {
  ChatStreamCallbacks,
  ChatStreamState,
  StreamingToolCall,
} from "./chat-stream-handler.ts";
export {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_STREAM_BUFFER_SIZE,
} from "./constants.ts";
export {
  captureStreamedToolCallInput,
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  collectPersistedToolResults,
  isRecoverablePlaceholderToolCall,
  isStreamedToolCallIncomplete,
  materializeStreamedToolCall,
  shouldContinueAfterStreamStep,
  type StreamedToolCallMaterialization,
} from "./tool-result-continuation.ts";

function resolveRuntimeGenAiProviderName(modelId: string): string | undefined {
  const normalizedModelId = modelId.startsWith("veryfront-cloud/")
    ? modelId.slice("veryfront-cloud/".length)
    : modelId;
  const provider = normalizedModelId.split("/")[0]?.trim().toLowerCase();

  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "google":
    case "google-ai-studio":
      return "gcp.gen_ai";
    case "moonshotai":
      return "moonshotai";
    default:
      return undefined;
  }
}
export {
  enforceSkillPolicy,
  extractSkillPolicy,
  type SkillPolicyResult,
} from "./skill-policy-enforcement.ts";

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, getModelMaxOutputTokens } from "./constants.ts";
import { closeSSEStream, generateMessageId, sendSSE } from "./sse-utils.ts";
import {
  executeConfiguredTool,
  getAvailableTools,
  isDynamicTool,
  type ToolConfigEntry,
} from "./tool-helpers.ts";
import { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
import { resolveRuntimeModel } from "./model-resolution.ts";
import type { RuntimeGenerateToolResult } from "./runtime-tool-types.ts";
import { stringifyToolError, throwIfAborted } from "./error-utils.ts";
import { resolveTemperatureParameter } from "./model-capabilities.ts";
import {
  applySkillDelegationOverridesToToolInput,
  extractSkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";
import { resolveAgentModelTransport, type ResolvedModelTransport } from "./model-transport.ts";
import { buildRuntimeUsageTraceAttributes } from "./trace-usage.ts";

const logger = serverLogger.component("agent");

function buildStreamFinishUsage(
  usage: AgentResponse["usage"],
): Record<string, unknown> | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.billableInputTokens !== undefined
      ? { billableInputTokens: usage.billableInputTokens }
      : {}),
    ...(usage.billableOutputTokens !== undefined
      ? { billableOutputTokens: usage.billableOutputTokens }
      : {}),
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(usage.providerInputCostUsd !== undefined
      ? { providerInputCostUsd: usage.providerInputCostUsd }
      : {}),
    ...(usage.providerOutputCostUsd !== undefined
      ? { providerOutputCostUsd: usage.providerOutputCostUsd }
      : {}),
    ...(usage.providerCostUsd !== undefined ? { providerCostUsd: usage.providerCostUsd } : {}),
    ...(usage.veryfrontInputChargeUsd !== undefined
      ? { veryfrontInputChargeUsd: usage.veryfrontInputChargeUsd }
      : {}),
    ...(usage.veryfrontOutputChargeUsd !== undefined
      ? { veryfrontOutputChargeUsd: usage.veryfrontOutputChargeUsd }
      : {}),
    ...(usage.veryfrontChargeUsd !== undefined
      ? { veryfrontChargeUsd: usage.veryfrontChargeUsd }
      : {}),
    ...(usage.veryfrontBilledUsd !== undefined
      ? { veryfrontBilledUsd: usage.veryfrontBilledUsd }
      : {}),
    ...(usage.costCredits !== undefined ? { costCredits: usage.costCredits } : {}),
    ...(usage.costSource !== undefined ? { costSource: usage.costSource } : {}),
    ...(usage.billingMode !== undefined ? { billingMode: usage.billingMode } : {}),
    ...(usage.usageCaptureStatus !== undefined
      ? { usageCaptureStatus: usage.usageCaptureStatus }
      : {}),
  };
}

function getResponseFinishReason(response: AgentResponse): string | undefined {
  const finishReason = response.metadata?.finishReason;
  return typeof finishReason === "string" && finishReason.length > 0 ? finishReason : undefined;
}

function shouldHideProjectToolAfterAgentWriteSuccess(toolName: string): boolean {
  return toolName === "create_agent" || toolName === "update_agent";
}

function parseToolResultJson(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function containsSubmittedFormInputExecutionResult(result: unknown, depth = 0): boolean {
  const normalized = typeof result === "string" ? parseToolResultJson(result) : result;
  if (!normalized || typeof normalized !== "object" || depth > 3) {
    return false;
  }
  if ((normalized as { submitted?: unknown }).submitted === true) {
    return true;
  }
  return Object.values(normalized).some((value) =>
    containsSubmittedFormInputExecutionResult(value, depth + 1)
  );
}

function isSubmittedFormInputExecutionResult(toolName: string, result: unknown): boolean {
  return toolName === FORM_INPUT_TOOL_ID && containsSubmittedFormInputExecutionResult(result);
}

type RuntimeTraceAttributes = Record<string, string | number | boolean | undefined | null>;

function estimateSerializedSizeBytes(value: unknown): number | undefined {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return new TextEncoder().encode(serialized).length;
  } catch {
    return undefined;
  }
}

function compactRuntimeTraceAttributes(
  attributes: RuntimeTraceAttributes,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ),
  ) as Record<string, string | number | boolean>;
}

function buildRuntimeToolTraceAttributes(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  context?: ToolExecutionContext;
  status?: "executing" | "completed" | "failed" | "blocked";
  providerExecuted?: boolean;
  inputSizeBytes?: number;
  outputSizeBytes?: number;
  errorType?: string;
  errorMessage?: string;
}): Record<string, string | number | boolean> {
  return compactRuntimeTraceAttributes({
    "agent.id": input.agentId,
    "run.id": input.context?.runId,
    "project.id": input.context?.projectId,
    "project.slug": input.context?.projectSlug,
    "tool.name": input.toolName,
    "tool.call.id": input.toolCallId,
    "tool.id": input.toolCallId,
    "tool.status": input.status,
    "tool.provider_executed": input.providerExecuted,
    "tool.input.size_bytes": input.inputSizeBytes,
    "tool.output.size_bytes": input.outputSizeBytes,
    "agent.tool.execution_mode": input.mode,
    "agent.tool.status": input.status,
    "agent.tool.provider_executed": input.providerExecuted,
    "agent.tool.input.size_bytes": input.inputSizeBytes,
    "agent.tool.output.size_bytes": input.outputSizeBytes,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.agent.id": input.agentId,
    "gen_ai.tool.name": input.toolName,
    "gen_ai.tool.type": "function",
    "gen_ai.tool.call.id": input.toolCallId,
    "error.type": input.errorType,
    "error.message": input.errorMessage,
  });
}

async function traceConfiguredToolExecution(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined;
  context: ToolExecutionContext;
  allowedRemoteToolNames: string[] | undefined;
  remoteToolSources: ReturnType<typeof getRuntimeRemoteToolSources>;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest | undefined;
}): Promise<unknown> {
  const inputSizeBytes = estimateSerializedSizeBytes(input.args);
  return await withSpan(
    "agent.tool_execute",
    async () => {
      setOtelActiveSpanAttributes(
        buildRuntimeToolTraceAttributes({
          mode: input.mode,
          agentId: input.agentId,
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          context: input.context,
          status: "executing",
          providerExecuted: false,
          inputSizeBytes,
        }),
      );
      try {
        const result = await executeConfiguredTool(
          input.toolName,
          input.args,
          input.toolsConfig,
          input.context,
          input.allowedRemoteToolNames,
          input.remoteToolSources,
          input.sourceIntegrationPolicy,
        );
        const resultError = getToolResultError(result);
        if (resultError !== undefined) {
          setOtelActiveSpanErrorStatus(resultError);
        }
        setOtelActiveSpanAttributes(
          buildRuntimeToolTraceAttributes({
            mode: input.mode,
            agentId: input.agentId,
            toolName: input.toolName,
            toolCallId: input.toolCallId,
            context: input.context,
            status: resultError === undefined ? "completed" : "failed",
            providerExecuted: false,
            inputSizeBytes,
            outputSizeBytes: estimateSerializedSizeBytes(result),
            errorType: resultError === undefined ? undefined : "ToolResultError",
            errorMessage: resultError,
          }),
        );
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setOtelActiveSpanAttributes({
          ...buildRuntimeToolTraceAttributes({
            mode: input.mode,
            agentId: input.agentId,
            toolName: input.toolName,
            toolCallId: input.toolCallId,
            context: input.context,
            status: "failed",
            providerExecuted: false,
            inputSizeBytes,
            errorType: error instanceof Error ? error.name : "Error",
            errorMessage,
          }),
        });
        throw error;
      }
    },
    buildRuntimeToolTraceAttributes({
      mode: input.mode,
      agentId: input.agentId,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      context: input.context,
      status: "executing",
      providerExecuted: false,
      inputSizeBytes,
    }),
  );
}

async function traceProviderExecutedTool(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  context?: ToolExecutionContext;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}): Promise<void> {
  const status = input.isError === true ? "failed" : "completed";
  const errorMessage = input.isError === true ? stringifyToolError(input.result) : undefined;
  await withSpan(
    "agent.tool_execute",
    async () => {
      if (errorMessage !== undefined) {
        setOtelActiveSpanErrorStatus(errorMessage);
      }
      setOtelActiveSpanAttributes(
        buildRuntimeToolTraceAttributes({
          ...input,
          status,
          providerExecuted: true,
          inputSizeBytes: estimateSerializedSizeBytes(input.args),
          outputSizeBytes: estimateSerializedSizeBytes(input.result),
          errorType: input.isError === true ? "ProviderExecutedToolError" : undefined,
          errorMessage,
        }),
      );
    },
    buildRuntimeToolTraceAttributes({
      ...input,
      status,
      providerExecuted: true,
      inputSizeBytes: estimateSerializedSizeBytes(input.args),
      outputSizeBytes: estimateSerializedSizeBytes(input.result),
      errorType: input.isError === true ? "ProviderExecutedToolError" : undefined,
      errorMessage,
    }),
  );
}

function markSubmittedFormInputRuntimeContext(
  runtimeContext?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(runtimeContext ?? {}),
    [SUBMITTED_FORM_INPUT_CONTEXT_KEY]: true,
  };
}

function isAbortError(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted && error === abortSignal.reason) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function warnLocalToolSkipping(agentId: string, modelId: string): void {
  logger.warn(
    `Agent "${agentId}" has tools configured but is using local model "${modelId}". ` +
      "Local models don't support tool calling. Tools will be skipped. " +
      "Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG, or configure " +
      "OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY for full tool support.",
  );
}

type RuntimeStepState = {
  systemPrompt: string;
  context?: Record<string, unknown>;
};

/** Implement agent runtime. */
export class AgentRuntime {
  private id: string;
  private config: AgentConfig;
  private memory: Memory<Message>;
  private status: AgentStatus = "idle";

  constructor(id: string, config: AgentConfig) {
    this.id = id;
    this.config = config;

    // Agents are stateless by default (see docs/guides/memory-and-streaming.md):
    // with no `memory` config, calls never share conversation history, so
    // concurrent stream()/generate() on a shared instance stay isolated.
    // Providing `memory` opts in to cross-call persistence.
    this.memory = createAgentMemory<Message>(config.memory);
  }

  /**
   * Persist this turn's input, then resolve the messages to run on. Configured
   * memory returns the full persisted conversation (this turn + history); the
   * stateless default persists nothing and returns empty, so we fall back to
   * this turn's input. That fallback is what keeps concurrent stream()/
   * generate() calls on a shared instance isolated instead of interleaving into
   * one conversation.
   */
  private async prepareTurnMessages(inputMessages: Message[]): Promise<Message[]> {
    for (const msg of inputMessages) await this.memory.add(msg);
    const persisted = await this.memory.getMessages();
    return persisted.length > 0 ? persisted : inputMessages;
  }

  private async resolveModelTransport(
    context: Record<string, unknown> | undefined,
    modelOverride: string | undefined,
    mode: "generate" | "stream",
  ): Promise<ResolvedModelTransport> {
    return await resolveAgentModelTransport({
      agentId: this.id,
      config: this.config,
      context,
      modelOverride,
      mode,
    });
  }

  private async resolveRuntimeState(
    messages: Message[],
    context: Record<string, unknown> | undefined,
    mode: "generate" | "stream",
    step: number,
    systemPrompt: string,
  ): Promise<RuntimeStepState> {
    const refreshed: ResolvedRuntimeState | undefined = await this.config.resolveRuntimeState?.({
      agentId: this.id,
      mode,
      step,
      system: systemPrompt,
      messages: [...messages],
      context,
    });

    return {
      systemPrompt: refreshed?.system ?? systemPrompt,
      context: refreshed?.context ?? context,
    };
  }

  private async notifyToolResult(
    request: Omit<ToolExecutionResultRequest, "agentId">,
  ): Promise<void> {
    await this.config.onToolResult?.({
      agentId: this.id,
      ...request,
    });
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(
    input: string | Message[],
    context?: Record<string, unknown>,
    modelOverride?: string,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
  ): Promise<AgentResponse> {
    throwIfAborted(abortSignal);
    const transport = await this.resolveModelTransport(context, modelOverride, "generate");
    const requestedModel = transport.requestedModel;
    const resolvedModelString = transport.resolvedModelString;
    if (resolvedModelString !== requestedModel) {
      logger.info(
        `⚡ Using runtime model "${resolvedModelString}" instead of "${requestedModel}".`,
      );
    }

    return withSpan("agent.generate", async (span) => {
      setSpanAttributes(span, {
        "agent.id": this.id,
        "agent.model": resolvedModelString,
      });

      const inputMessages = normalizeInput(input);
      const messages = await this.prepareTurnMessages(inputMessages);

      const systemPrompt = await this.resolveSystemPrompt();

      const agentContext: AgentContext = {
        agentId: this.id,
        model: resolvedModelString,
        input: inputMessages,
        data: context,
        platform: detectPlatform(),
      };

      const chain = new MiddlewareChain(this.config.middleware);
      return chain.execute(
        agentContext,
        () =>
          this.executeAgentLoop(
            systemPrompt,
            messages,
            {
              agentId: this.id,
              projectId: tryGetCacheKeyContext()?.projectId,
            },
            context,
            resolvedModelString,
            transport.languageModel,
            transport.headers,
            transport.providerOptions,
            transport.reasoning,
            maxOutputTokensOverride,
            requestedModel,
            abortSignal,
          ),
      );
    });
  }

  /**
   * Stream a response
   * Returns a ReadableStream in the veryfront stream event format.
   */
  async stream(
    messages: Message[],
    context?: Record<string, unknown>,
    callbacks?: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
      onFinish?: (response: AgentResponse) => void;
    },
    modelOverride?: string,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const transport = await this.resolveModelTransport(context, modelOverride, "stream");
    const requestedModel = transport.requestedModel;
    const resolvedModelString = transport.resolvedModelString;
    if (resolvedModelString !== requestedModel) {
      logger.info(
        `⚡ Using runtime model "${resolvedModelString}" instead of "${requestedModel}".`,
      );
    }

    const memoryMessages = await this.prepareTurnMessages(messages);

    const systemPrompt = await this.resolveSystemPrompt();

    const encoder = new TextEncoder();
    const streamAbortController = new AbortController();
    const forwardAbort = () => {
      streamAbortController.abort(abortSignal?.reason);
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        streamAbortController.abort(abortSignal.reason);
      } else {
        abortSignal.addEventListener("abort", forwardAbort, { once: true });
      }
    }
    const streamAbortSignal = streamAbortController.signal;
    const streamCacheCtx = tryGetCacheKeyContext();
    const toolContext = {
      agentId: this.id,
      abortSignal: streamAbortSignal,
      projectId: streamCacheCtx?.projectId,
      ...context,
    };
    const textPartId = generateId("text");

    // Resolve model BEFORE creating the ReadableStream. If this throws
    // (e.g., no_ai_available), the error propagates to the caller who can
    // return a proper error response (503) instead of a 200 with an error event.
    const languageModel = transport.languageModel;

    // Determine inference mode from the resolved model object, not the string.
    const isLocal = isLocalModelRuntime(languageModel);

    // Eagerly verify the model runtime is available. For local models this
    // checks that @huggingface/transformers can be imported. Must happen
    // BEFORE creating the ReadableStream so no_ai_available errors propagate
    // to the route handler, which returns a 503 instead of swallowing it as an
    // in-band SSE error in a 200 response.
    await ensureModelReady(languageModel);

    const agentContext: AgentContext = {
      agentId: this.id,
      model: resolvedModelString,
      input: messages,
      data: context,
      platform: detectPlatform(),
    };
    const chain = new MiddlewareChain(this.config.middleware);

    // Hold the in-flight agent-loop promise so stream cancellation can detach a
    // no-op rejection handler. When the client cancels, we abort the shared
    // signal; the loop (model fetch / tool execution) then rejects with an
    // AbortError. The `start` body awaits it, but cancellation can land after
    // that await settles, leaving the rejection without a consumer, fatal as
    // an unhandled rejection under Deno (#2334).
    let inFlight: Promise<AgentResponse> | undefined;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          throwIfAborted(streamAbortSignal);
          this.status = "streaming";

          const messageId = generateMessageId();
          sendSSE(controller, encoder, { type: "message-start", messageId });
          // Report the effective model after resolution so the client can show
          // whether inference is cloud or explicit server-local.
          sendSSE(controller, encoder, {
            type: "data",
            data: {
              inferenceMode: isLocal ? "server-local" : "cloud",
              model: resolvedModelString,
            },
          });
          inFlight = chain.execute(
            agentContext,
            () =>
              this.executeAgentLoopStreaming(
                systemPrompt,
                memoryMessages,
                controller,
                encoder,
                callbacks,
                textPartId,
                toolContext,
                context,
                resolvedModelString,
                languageModel,
                transport.headers,
                transport.providerOptions,
                transport.reasoning,
                maxOutputTokensOverride,
                streamAbortSignal,
                requestedModel,
              ),
          );
          const response = await inFlight;
          throwIfAborted(streamAbortSignal);
          callbacks?.onFinish?.(response);
          throwIfAborted(streamAbortSignal);

          const finishUsage = buildStreamFinishUsage(response.usage);
          const finishReason = getResponseFinishReason(response);
          sendSSE(controller, encoder, {
            type: "message-finish",
            ...(finishReason ? { finishReason } : {}),
            ...(finishUsage ? { totalUsage: finishUsage } : {}),
          });
          closeSSEStream(controller);
        } catch (error) {
          if (isAbortError(error, streamAbortSignal)) {
            closeSSEStream(controller);
            return;
          }

          this.status = "error";
          logger.error("Agent stream error", { error });
          sendSSE(controller, encoder, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          closeSSEStream(controller);
        } finally {
          abortSignal?.removeEventListener("abort", forwardAbort);
        }
      },
      cancel(reason) {
        // The client disconnected (e.g. the Chat Stop button). Treat this as a
        // clean stop: detach a no-op handler from the in-flight loop so the
        // AbortError it throws when we abort the shared signal cannot surface as
        // an unhandled rejection, then abort. Guard the abort itself so a
        // synchronous signal-abort rejection can never escape here (#2334).
        inFlight?.catch(() => {});
        try {
          streamAbortController.abort(reason);
        } catch {
          // Aborting an already-aborted controller, or a synchronous reject
          // from a signal consumer, is a no-op for cancellation purposes.
        }
      },
    });
  }

  /**
   * Execute agent loop (with tool calling)
   */
  private async executeAgentLoop(
    systemPrompt: string,
    messages: Message[],
    toolContextBase?: ToolExecutionContext,
    runtimeContext?: Record<string, unknown>,
    modelString?: string,
    resolvedModel?: ModelRuntime,
    headers?: HeadersInit,
    providerOptions?: Record<string, unknown>,
    reasoning?: RuntimeReasoningOption,
    maxOutputTokensOverride?: number,
    temperatureModelString?: string,
    abortSignal?: AbortSignal,
  ): Promise<AgentResponse> {
    return withSpan("agent.execution_loop", async (loopSpan) => {
      const { maxAgentSteps } = getPlatformCapabilities();
      const maxSteps = this.computeMaxSteps(maxAgentSteps);
      const effectiveModel = resolveRuntimeModel(modelString || this.config.model);
      const languageModel = resolvedModel ?? resolveModel(effectiveModel);

      const toolCalls: ToolCall[] = [];
      const currentMessages = [...messages];
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      // Local models can't reliably do function calling, so skip tools gracefully.
      const isLocal = isLocalModelRuntime(languageModel);
      if (isLocal && this.config.tools) {
        warnLocalToolSkipping(this.id, effectiveModel);
      }

      // Request-scoped skill policy (not class-level mutable state)
      const hydratedSkillState = hydrateActiveSkillStateFromMessages(currentMessages);
      let activeSkillId = hydratedSkillState.activeSkillId;
      let activeSkillPolicy = hydratedSkillState.activeSkillPolicy;
      let activeSkillToolAvailability = hydratedSkillState.activeSkillToolAvailability;
      let activeSkillDelegationOverrides = hydratedSkillState.activeSkillDelegationOverrides;
      let hasSubmittedFormInputInLoop = hasSubmittedFormInputResult(currentMessages) ||
        runtimeContext?.[SUBMITTED_FORM_INPUT_CONTEXT_KEY] === true;
      const allowedRemoteToolNames = getRuntimeAllowedRemoteTools(this.config);
      const forwardedRemoteToolDefinitions = getRuntimeForwardedIntegrationToolDefs(this.config);
      const remoteToolSources = getRuntimeRemoteToolSources(this.config);
      const sourceIntegrationPolicy = getRuntimeSourceIntegrationPolicy(this.config);
      const configuredProviderTools = getRuntimeProviderTools(this.config);
      const providerTools = sourceIntegrationPolicy
        ? applySourceIntegrationPolicy(configuredProviderTools, sourceIntegrationPolicy)
        : configuredProviderTools;
      let currentSystemPrompt = systemPrompt;
      let currentRuntimeContext = runtimeContext;
      let agentWriteFinalResponseToolGuardEnabled = false;

      for (let step = 0; step < maxSteps; step++) {
        throwIfAborted(abortSignal);
        this.status = "thinking";
        addSpanEvent(loopSpan, "step_start", { step });
        const stepRuntimeContext = hasSubmittedFormInputInLoop
          ? markSubmittedFormInputRuntimeContext(currentRuntimeContext)
          : currentRuntimeContext;

        const preparedStep = await prepareAgentRuntimeStep({
          agentId: this.id,
          activeSkillId,
          activeSkillPolicy,
          activeSkillToolAvailability,
          allowedRemoteToolNames,
          config: this.config,
          forwardedRemoteToolDefinitions,
          getAvailableTools,
          isLocalModel: isLocal,
          messages: currentMessages,
          mode: "generate",
          remoteToolSources,
          sourceIntegrationPolicy,
          resolveRuntimeState: this.resolveRuntimeState.bind(this),
          runtimeContext: stepRuntimeContext,
          step,
          systemPrompt: currentSystemPrompt,
          toolContextBase: { ...toolContextBase, abortSignal },
        });
        throwIfAborted(abortSignal);
        currentSystemPrompt = preparedStep.systemPrompt;
        currentRuntimeContext = preparedStep.runtimeContext;
        const toolContext = preparedStep.toolContext;
        const tools = agentWriteFinalResponseToolGuardEnabled
          ? preparedStep.tools.filter((tool) =>
            !shouldHideProjectToolAfterAgentWriteSuccess(tool.name)
          )
          : preparedStep.tools;
        const stepProviderTools = agentWriteFinalResponseToolGuardEnabled ? [] : providerTools;

        const temperature = this.resolveTemperature(
          temperatureModelString ?? effectiveModel,
          providerOptions,
        );
        const response = await withSpan("agent.generate_text", async (span) => {
          setSpanAttributes(span, {
            "model.id": effectiveModel,
            "messages.count": currentMessages.length,
          });
          const result = await generateText({
            model: languageModel,
            system: currentSystemPrompt,
            messages: convertToTextGenerationRuntimeRequestMessages(currentMessages),
            tools: convertToolsToRuntimeTools(tools, {
              model: effectiveModel,
              providerTools: stepProviderTools,
            }),
            experimental_repairToolCall: repairToolCall,
            maxOutputTokens: this.resolveMaxOutputTokens(effectiveModel, maxOutputTokensOverride),
            ...(temperature === undefined ? {} : { temperature }),
            ...(headers ? { headers } : {}),
            ...(providerOptions ? { providerOptions } : {}),
            ...(reasoning ? { reasoning } : {}),
            abortSignal,
          });
          setSpanAttributes(span, buildRuntimeUsageTraceAttributes(result.usage));
          return result;
        });
        throwIfAborted(abortSignal);

        // Accumulate usage
        if (response.usage) {
          const input = response.usage.inputTokens ?? 0;
          const output = response.usage.outputTokens ?? 0;
          accumulateUsage(totalUsage, {
            promptTokens: input,
            completionTokens: output,
            totalTokens: response.usage.totalTokens ?? input + output,
            cachedInputTokens: response.usage.cachedInputTokens ??
              response.usage.cacheReadInputTokens,
            cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
            cacheReadInputTokens: response.usage.cacheReadInputTokens,
            reasoningTokens: response.usage.reasoningTokens,
            billableInputTokens: response.usage.billableInputTokens,
            billableOutputTokens: response.usage.billableOutputTokens,
            costUsd: response.usage.costUsd,
            providerInputCostUsd: response.usage.providerInputCostUsd,
            providerOutputCostUsd: response.usage.providerOutputCostUsd,
            providerCostUsd: response.usage.providerCostUsd,
            veryfrontInputChargeUsd: response.usage.veryfrontInputChargeUsd,
            veryfrontOutputChargeUsd: response.usage.veryfrontOutputChargeUsd,
            veryfrontChargeUsd: response.usage.veryfrontChargeUsd,
            veryfrontBilledUsd: response.usage.veryfrontBilledUsd,
            costCredits: response.usage.costCredits,
            costSource: response.usage.costSource,
            billingMode: response.usage.billingMode,
            usageCaptureStatus: response.usage.usageCaptureStatus,
          });
          setSpanAttributes(loopSpan, buildRuntimeUsageTraceAttributes(totalUsage));
        }

        const assistantParts: MessagePart[] = [];
        if (response.text) assistantParts.push({ type: "text", text: response.text });

        for (const tc of response.toolCalls ?? []) {
          assistantParts.push({
            type: `tool-${tc.toolName}`,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.input as Record<string, unknown>,
          });
        }

        const assistantMessage: Message = {
          id: `msg_${Date.now()}_${step}`,
          role: "assistant",
          parts: assistantParts,
          timestamp: Date.now(),
        };
        currentMessages.push(assistantMessage);
        await this.memory.add(assistantMessage);
        throwIfAborted(abortSignal);
        const generatedToolResults = collectGeneratedToolResults(response.toolResults);

        const persistGeneratedToolResult = async (
          generatedToolResult: RuntimeGenerateToolResult,
        ): Promise<void> => {
          const toolResultMessage = createToolResultMessage(
            generatedToolResult.toolCallId,
            generatedToolResult.toolName,
            generatedToolResult.isError === true
              ? { error: stringifyToolError(generatedToolResult.result) }
              : generatedToolResult.result,
            generatedToolResult.providerExecuted === true,
          );
          currentMessages.push(toolResultMessage);
          await this.memory.add(toolResultMessage);
          throwIfAborted(abortSignal);
        };

        if (!response.toolCalls?.length) {
          for (const generatedToolResult of generatedToolResults.values()) {
            await persistGeneratedToolResult(generatedToolResult);
          }
          this.status = "completed";
          addSpanEvent(loopSpan, "loop_complete");
          setSpanAttributes(loopSpan, buildRuntimeUsageTraceAttributes(totalUsage));
          return {
            text: response.text,
            messages: currentMessages,
            toolCalls,
            status: this.status,
            usage: totalUsage,
          };
        }

        this.status = "tool_execution";
        addSpanEvent(loopSpan, "tool_execution_start", { count: response.toolCalls.length });
        let mustLoadSkillFirst = !activeSkillPolicy &&
          response.toolCalls.some((tc) => tc.toolName === LOAD_SKILL_TOOL_ID);

        for (const tc of response.toolCalls) {
          throwIfAborted(abortSignal);
          const toolCall: ToolCall = {
            id: tc.toolCallId,
            name: tc.toolName,
            args: tc.input as Record<string, unknown>,
            status: "pending",
          };
          const generatedToolResult = generatedToolResults.get(tc.toolCallId);

          await withSpan("agent.tool_execute", async (toolSpan) => {
            const inputSizeBytes = estimateSerializedSizeBytes(tc.input);
            setSpanAttributes(
              toolSpan,
              compactRuntimeTraceAttributes({
                "tool.name": tc.toolName,
                "tool.call.id": tc.toolCallId,
                "tool.id": tc.toolCallId,
                "tool.status": "executing",
                "tool.input.size_bytes": inputSizeBytes,
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": tc.toolName,
                "gen_ai.tool.type": "function",
                "gen_ai.tool.call.id": tc.toolCallId,
              }),
            );

            if (generatedToolResult) {
              if (generatedToolResult.providerExecuted === true) {
                await traceProviderExecutedTool({
                  mode: "generate",
                  agentId: this.id,
                  toolName: tc.toolName,
                  toolCallId: tc.toolCallId,
                  context: {
                    toolCallId: tc.toolCallId,
                    ...toolContext,
                    agentId: this.id,
                  },
                  args: tc.input,
                  result: generatedToolResult.result,
                  isError: generatedToolResult.isError === true,
                });
              }
              await persistGeneratedToolResult(generatedToolResult);
              toolCall.status = generatedToolResult.isError === true ? "error" : "completed";
              toolCall.result = generatedToolResult.result;
              toolCall.error = generatedToolResult.isError === true
                ? stringifyToolError(generatedToolResult.result)
                : undefined;
              if (toolCall.error !== undefined) {
                setOtelActiveSpanErrorStatus(toolCall.error);
              }
              if (
                generatedToolResult.isError !== true &&
                shouldHideProjectToolAfterAgentWriteSuccess(tc.toolName)
              ) {
                agentWriteFinalResponseToolGuardEnabled = true;
              }
              setSpanAttributes(
                toolSpan,
                compactRuntimeTraceAttributes({
                  "tool.status": generatedToolResult.isError === true ? "failed" : "completed",
                  "tool.provider_executed": generatedToolResult.providerExecuted === true,
                  "tool.output.size_bytes": estimateSerializedSizeBytes(generatedToolResult.result),
                  ...(toolCall.error
                    ? {
                      error: true,
                      "error.type": "ProviderExecutedToolError",
                      "error.message": toolCall.error,
                    }
                    : {}),
                }),
              );
              toolCalls.push(toolCall);
              return;
            }

            const policyCheck = enforceSkillPolicy(
              tc.toolName,
              activeSkillPolicy,
              mustLoadSkillFirst,
              {
                hasSubmittedFormInput: hasSubmittedFormInputInLoop,
                skillToolAvailability: activeSkillToolAvailability,
              },
            );
            if (!policyCheck.allowed) {
              toolCall.status = "error";
              toolCall.error = policyCheck.error;
              setSpanAttributes(toolSpan, {
                "tool.status": "blocked",
                error: true,
                "error.type": "ToolPolicyBlocked",
                "error.message": policyCheck.error,
              });

              const errorMessage: Message = {
                id: `tool_error_${tc.toolCallId}`,
                role: "tool",
                parts: [{
                  type: "tool-result",
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  result: { error: policyCheck.error },
                }],
                timestamp: Date.now(),
              };
              currentMessages.push(errorMessage);
              await this.memory.add(errorMessage);
              toolCalls.push(toolCall);
              return;
            }

            try {
              toolCall.status = "executing";
              const startTime = Date.now();

              const cacheCtx = tryGetCacheKeyContext();
              toolCall.args = applySkillDelegationOverridesToToolInput(
                tc.toolName,
                toolCall.args,
                activeSkillDelegationOverrides,
              );
              const executionContext = {
                toolCallId: tc.toolCallId,
                ...toolContext,
                projectId: cacheCtx?.projectId ?? toolContext?.projectId,
                // Caller identity for capability scoping. Stamped after the
                // spreads so caller-supplied context cannot spoof it.
                agentId: this.id,
              };
              throwIfAborted(abortSignal);
              const result = await traceConfiguredToolExecution({
                mode: "generate",
                agentId: this.id,
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                args: toolCall.args,
                toolsConfig: this.config.tools,
                context: executionContext,
                allowedRemoteToolNames,
                remoteToolSources,
                sourceIntegrationPolicy,
              });
              await this.notifyToolResult({
                mode: "generate",
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                input: toolCall.args,
                result,
                context: executionContext,
              });

              const resultError = getToolResultError(result);
              if (resultError !== undefined) {
                setOtelActiveSpanErrorStatus(resultError);
              }
              toolCall.status = resultError === undefined ? "completed" : "error";
              toolCall.result = result;
              toolCall.error = resultError;
              toolCall.executionTime = Date.now() - startTime;
              setSpanAttributes(
                toolSpan,
                compactRuntimeTraceAttributes({
                  "tool.status": resultError === undefined ? "completed" : "failed",
                  "tool.provider_executed": false,
                  "tool.output.size_bytes": estimateSerializedSizeBytes(result),
                  ...(resultError === undefined ? {} : {
                    error: true,
                    "error.type": "ToolResultError",
                    "error.message": resultError,
                  }),
                }),
              );

              if (resultError === undefined) {
                if (shouldHideProjectToolAfterAgentWriteSuccess(tc.toolName)) {
                  agentWriteFinalResponseToolGuardEnabled = true;
                }
                // Track skill policy from successful load_skill results
                if (tc.toolName === LOAD_SKILL_TOOL_ID) {
                  activeSkillId = extractSkillId(result);
                  activeSkillPolicy = extractSkillPolicy(result);
                  activeSkillToolAvailability = extractSkillToolAvailability(result) ??
                    INACTIVE_SKILL_TOOL_AVAILABILITY;
                  activeSkillDelegationOverrides = extractSkillDelegationOverrides(result);
                  mustLoadSkillFirst = false;
                }
                activeSkillPolicy = removeFormInputAfterSubmission(
                  tc.toolName,
                  result,
                  activeSkillId,
                  activeSkillPolicy,
                );
                if (isSubmittedFormInputExecutionResult(tc.toolName, result)) {
                  hasSubmittedFormInputInLoop = true;
                  currentRuntimeContext = markSubmittedFormInputRuntimeContext(
                    currentRuntimeContext,
                  );
                }
              }

              const toolResultMessage = createToolResultMessage(
                tc.toolCallId,
                tc.toolName,
                result,
              );
              currentMessages.push(toolResultMessage);
              await this.memory.add(toolResultMessage);
            } catch (error) {
              throwIfAborted(abortSignal);
              toolCall.status = "error";
              toolCall.error = error instanceof Error ? error.message : String(error);
              setSpanAttributes(toolSpan, {
                "tool.status": "failed",
                error: true,
                "error.type": error instanceof Error ? error.name : "Error",
                "error.message": toolCall.error,
              });

              const errorMessage = createToolErrorMessage(
                tc.toolCallId,
                tc.toolName,
                toolCall.error,
              );
              currentMessages.push(errorMessage);
              await this.memory.add(errorMessage);
            }

            toolCalls.push(toolCall);
          });
          throwIfAborted(abortSignal);
        }
      }

      throwIfAborted(abortSignal);
      this.status = "completed";
      addSpanEvent(loopSpan, "max_steps_reached", { maxSteps });
      setSpanAttributes(loopSpan, buildRuntimeUsageTraceAttributes(totalUsage));

      const lastMsg = currentMessages[currentMessages.length - 1];
      return {
        text: lastMsg ? getTextFromParts(lastMsg.parts) : "",
        messages: currentMessages,
        toolCalls,
        status: this.status,
        usage: totalUsage,
        metadata: { warning: `Max steps (${maxSteps}) reached` },
      };
    });
  }

  /**
   * Execute agent loop with streaming
   * Emits veryfront stream events (message-start/message-finish + step-start/step-end)
   * while consuming model-runtime `streamText()` parts internally.
   */
  private async executeAgentLoopStreaming(
    systemPrompt: string,
    messages: Message[],
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    callbacks?: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
      onFinish?: (response: AgentResponse) => void;
    },
    textPartId?: string,
    toolContextBase?: Record<string, unknown>,
    runtimeContext?: Record<string, unknown>,
    modelString?: string,
    resolvedModel?: ModelRuntime,
    headers?: HeadersInit,
    providerOptions?: Record<string, unknown>,
    reasoning?: RuntimeReasoningOption,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
    temperatureModelString?: string,
  ): Promise<AgentResponse> {
    const { maxAgentSteps } = getPlatformCapabilities();
    const maxSteps = this.computeMaxSteps(maxAgentSteps);
    const effectiveModel = resolveRuntimeModel(modelString || this.config.model);
    const languageModel = resolvedModel ?? resolveModel(effectiveModel);

    const toolCalls: ToolCall[] = [];
    const currentMessages = [...messages];
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Local models can't reliably do function calling, so skip tools gracefully.
    const isLocalStreaming = isLocalModelRuntime(languageModel);
    if (isLocalStreaming && this.config.tools) {
      warnLocalToolSkipping(this.id, effectiveModel);
    }

    // Request-scoped skill policy (not class-level mutable state)
    const hydratedSkillState = hydrateActiveSkillStateFromMessages(currentMessages);
    let activeSkillId = hydratedSkillState.activeSkillId;
    let activeSkillPolicy = hydratedSkillState.activeSkillPolicy;
    let activeSkillToolAvailability = hydratedSkillState.activeSkillToolAvailability;
    let activeSkillDelegationOverrides = hydratedSkillState.activeSkillDelegationOverrides;
    let hasSubmittedFormInputInLoop = hasSubmittedFormInputResult(currentMessages) ||
      runtimeContext?.[SUBMITTED_FORM_INPUT_CONTEXT_KEY] === true;
    let finalFinishReason: string | undefined;
    let latestAssistantText = "";
    const allowedRemoteToolNames = getRuntimeAllowedRemoteTools(this.config);
    const forwardedRemoteToolDefinitions = getRuntimeForwardedIntegrationToolDefs(this.config);
    const remoteToolSources = getRuntimeRemoteToolSources(this.config);
    const sourceIntegrationPolicy = getRuntimeSourceIntegrationPolicy(this.config);
    const configuredProviderTools = getRuntimeProviderTools(this.config);
    const providerTools = sourceIntegrationPolicy
      ? applySourceIntegrationPolicy(configuredProviderTools, sourceIntegrationPolicy)
      : configuredProviderTools;
    let currentSystemPrompt = systemPrompt;
    let currentRuntimeContext = runtimeContext;
    let agentWriteFinalResponseToolGuardEnabled = false;

    for (let step = 0; step < maxSteps; step++) {
      throwIfAborted(abortSignal);
      sendSSE(controller, encoder, { type: "step-start" });
      const currentStepToolResults = new Map<string, ToolResultPart>();
      const stepRuntimeContext = hasSubmittedFormInputInLoop
        ? markSubmittedFormInputRuntimeContext(currentRuntimeContext)
        : currentRuntimeContext;

      const preparedStep = await prepareAgentRuntimeStep({
        agentId: this.id,
        activeSkillId,
        activeSkillPolicy,
        activeSkillToolAvailability,
        allowedRemoteToolNames,
        config: this.config,
        forwardedRemoteToolDefinitions,
        getAvailableTools,
        isLocalModel: isLocalStreaming,
        messages: currentMessages,
        mode: "stream",
        remoteToolSources,
        sourceIntegrationPolicy,
        resolveRuntimeState: this.resolveRuntimeState.bind(this),
        runtimeContext: stepRuntimeContext,
        step,
        systemPrompt: currentSystemPrompt,
        toolContextBase,
      });
      currentSystemPrompt = preparedStep.systemPrompt;
      currentRuntimeContext = preparedStep.runtimeContext;
      const toolContext = preparedStep.toolContext;
      const tools = agentWriteFinalResponseToolGuardEnabled
        ? preparedStep.tools.filter((tool) =>
          !shouldHideProjectToolAfterAgentWriteSuccess(tool.name)
        )
        : preparedStep.tools;
      const stepProviderTools = agentWriteFinalResponseToolGuardEnabled ? [] : providerTools;

      const runtimeTools = convertToolsToRuntimeTools(tools, {
        model: effectiveModel,
        providerTools: stepProviderTools,
      });
      const runtimeToolNames = Object.keys(runtimeTools ?? {});

      const temperature = this.resolveTemperature(
        temperatureModelString ?? effectiveModel,
        providerOptions,
      );
      const maxOutputTokens = this.resolveMaxOutputTokens(effectiveModel, maxOutputTokensOverride);
      const genAiProviderName = resolveRuntimeGenAiProviderName(effectiveModel);
      const result = streamText({
        model: languageModel,
        system: currentSystemPrompt,
        messages: convertToTextGenerationRuntimeRequestMessages(currentMessages),
        tools: runtimeTools,
        experimental_repairToolCall: repairToolCall,
        maxOutputTokens,
        ...(temperature === undefined ? {} : { temperature }),
        ...(headers ? { headers } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        ...(reasoning ? { reasoning } : {}),
        abortSignal,
      });

      const state = createStreamState();
      await processStream(result, state, controller, encoder, textPartId, {
        onChunk: callbacks?.onChunk,
        onUsage: (usage) => accumulateUsage(totalUsage, usage),
        providerExecutedToolNames: getProviderExecutedToolNames(runtimeTools),
        availableToolNames: runtimeToolNames,
        traceSpanName: `chat ${effectiveModel}`,
        traceAttributes: {
          ...(genAiProviderName ? { "gen_ai.provider.name": genAiProviderName } : {}),
          "gen_ai.request.model": effectiveModel,
          "gen_ai.response.model": effectiveModel,
          "gen_ai.request.max_tokens": maxOutputTokens,
          "gen_ai.output.type": "text",
          ...(temperature === undefined ? {} : { "gen_ai.request.temperature": temperature }),
        },
      }, abortSignal);
      throwIfAborted(abortSignal);
      finalFinishReason = state.finishReason ?? finalFinishReason;

      const assistantMessage = buildStreamedAssistantMessage(state, {
        id: `msg_${Date.now()}_${step}`,
        timestamp: Date.now(),
      });

      for (const tc of state.toolCalls.values()) {
        const materialized = materializeStreamedToolCall(tc);

        if (materialized.kind === "incomplete" && isRecoverablePlaceholderToolCall(tc)) {
          // Provisional empty-object placeholder that never finalized. The
          // model never committed arguments. The assistant message builder
          // omits it when final text exists; otherwise it remains transparent
          // history while the loop recovers by re-calling the model. Surface no
          // termination warning or error.
          continue;
        }

        if (materialized.kind === "incomplete") {
          // Stream terminated before the provider emitted the finalizing
          // `tool-call` event for this block. The model never committed this
          // tool use. Surface the failure via SSE so the live client can
          // react, and leave the partial fragment under `inputText` in the
          // persisted part above so the history is replayable and transparent.
          logger.warn("Streamed tool call terminated before tool-call event", {
            toolCallId: tc.id,
            toolName: tc.name,
            partialArgumentsLength: materialized.partialArgumentsLength,
            partialArgumentsPreview: materialized.partialArgumentsPreview,
          });
          if (tc.inputAnnounced === true) {
            const dynamicIncomplete = isDynamicTool(tc.name);
            sendSSE(controller, encoder, {
              type: "tool-input-error",
              toolCallId: tc.id,
              errorText: `Stream terminated before tool-call event fired for "${tc.name}". ` +
                `Received ${materialized.partialArgumentsLength} chars of partial tool-input deltas.`,
              ...(dynamicIncomplete ? { dynamic: true } : {}),
            });
          }
        } else if (materialized.kind === "parse-error") {
          logger.warn("Failed to parse streamed tool arguments", {
            toolCallId: tc.id,
            error: materialized.parseError,
          });
        }
      }

      latestAssistantText = getTextFromParts(assistantMessage.parts);
      currentMessages.push(assistantMessage);
      await this.memory.add(assistantMessage);

      if (state.suppressedToolCalls.length > 0) {
        const unavailableNames = [
          ...new Set(state.suppressedToolCalls.map((toolCall) => toolCall.name)),
        ];
        currentMessages.push({
          id: `runtime_note_${Date.now()}_${step}`,
          role: "user",
          parts: [{
            type: "text",
            text: `Runtime recovery: ignored unavailable tool call(s): ${
              unavailableNames.join(", ")
            }. Continue using only currently available tools: ${runtimeToolNames.join(", ")}.`,
          }],
          timestamp: Date.now(),
        });
      }

      const finalToolResults = collectFinalStreamToolResults(state);

      const persistToolResult = async (toolResult: StreamingToolResult): Promise<void> => {
        if (currentStepToolResults.has(toolResult.toolCallId)) {
          return;
        }

        const toolResultMessage = createToolResultMessage(
          toolResult.toolCallId,
          toolResult.toolName,
          toolResult.error === undefined
            ? toolResult.output
            : { error: stringifyToolError(toolResult.error) },
          toolResult.providerExecuted === true,
        );
        currentMessages.push(toolResultMessage);
        await this.memory.add(toolResultMessage);
        currentStepToolResults.set(
          toolResult.toolCallId,
          toolResultMessage.parts[0] as ToolResultPart,
        );
      };

      if (!shouldContinueAfterStreamStep(state)) {
        for (const toolResult of finalToolResults.values()) {
          await persistToolResult(toolResult);
        }
        sendSSE(controller, encoder, { type: "step-end" });
        break;
      }

      this.status = "tool_execution";
      const streamedToolCalls = Array.from(state.toolCalls.values());
      let mustLoadSkillFirst = !activeSkillPolicy &&
        streamedToolCalls.some((tc) => tc.name === LOAD_SKILL_TOOL_ID);

      for (const tc of streamedToolCalls) {
        throwIfAborted(abortSignal);
        if (isRecoverablePlaceholderToolCall(tc)) {
          // Provisional empty-object placeholder that never finalized. The
          // model never committed arguments. At this point the continuation
          // gate has confirmed there is no final assistant text, so the loop
          // can continue and let the next model call recover the real tool
          // call without executing or surfacing a stream-termination error.
          continue;
        }
        if (isStreamedToolCallIncomplete(tc)) {
          // Stream ended before the provider finalized this tool call. We
          // cannot execute it, so record a distinct stream-termination error
          // (not a tool-argument parse error) so the parent step and any
          // upstream orchestrator (e.g. the child-fork watchdog) see a
          // completed step with a clearly-labelled failure and can recover.
          const incompleteToolCall: ToolCall = {
            id: tc.id,
            name: tc.name,
            args: {},
            ...(tc.arguments.length > 0 ? { inputText: tc.arguments } : {}),
            status: "pending",
          };
          await this.recordToolError(
            incompleteToolCall,
            `Stream terminated before tool-call event fired for "${tc.name}". ` +
              `Received ${tc.arguments.length} chars of partial tool-input deltas.`,
            controller,
            encoder,
            currentMessages,
            toolCalls,
            { emitSse: tc.inputAnnounced === true },
          );
          continue;
        }
        const capturedInput = captureStreamedToolCallInput(tc);
        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name,
          args: capturedInput.args,
          ...(capturedInput.inputText ? { inputText: capturedInput.inputText } : {}),
          status: "pending",
        };
        const matchingResult = finalToolResults.get(tc.id);
        const persistedResult = currentStepToolResults.get(tc.id);

        if (matchingResult) {
          await persistToolResult(matchingResult);
          toolCall.status = matchingResult.error === undefined ? "completed" : "error";
          toolCall.result = matchingResult.output;
          toolCall.error = matchingResult.error === undefined
            ? undefined
            : stringifyToolError(matchingResult.error);
          toolCalls.push(toolCall);

          if (matchingResult.error === undefined) {
            if (shouldHideProjectToolAfterAgentWriteSuccess(tc.name)) {
              agentWriteFinalResponseToolGuardEnabled = true;
            }
            if (tc.name === LOAD_SKILL_TOOL_ID) {
              activeSkillId = extractSkillId(matchingResult.output);
              activeSkillPolicy = extractSkillPolicy(matchingResult.output);
              activeSkillToolAvailability = extractSkillToolAvailability(matchingResult.output) ??
                INACTIVE_SKILL_TOOL_AVAILABILITY;
              activeSkillDelegationOverrides = extractSkillDelegationOverrides(
                matchingResult.output,
              );
              mustLoadSkillFirst = false;
            }
            activeSkillPolicy = removeFormInputAfterSubmission(
              tc.name,
              matchingResult.output,
              activeSkillId,
              activeSkillPolicy,
            );
            if (isSubmittedFormInputExecutionResult(tc.name, matchingResult.output)) {
              hasSubmittedFormInputInLoop = true;
              currentRuntimeContext = markSubmittedFormInputRuntimeContext(currentRuntimeContext);
            }
          }
          continue;
        }

        if (persistedResult) {
          const persistedError = getToolResultError(persistedResult.result);
          toolCall.status = persistedError === undefined ? "completed" : "error";
          toolCall.result = persistedResult.result;
          toolCall.error = persistedError;
          toolCalls.push(toolCall);
          if (persistedError === undefined) {
            if (shouldHideProjectToolAfterAgentWriteSuccess(tc.name)) {
              agentWriteFinalResponseToolGuardEnabled = true;
            }
            if (tc.name === LOAD_SKILL_TOOL_ID) {
              activeSkillId = extractSkillId(persistedResult.result);
              activeSkillPolicy = extractSkillPolicy(persistedResult.result);
              activeSkillToolAvailability = extractSkillToolAvailability(persistedResult.result) ??
                INACTIVE_SKILL_TOOL_AVAILABILITY;
              activeSkillDelegationOverrides = extractSkillDelegationOverrides(
                persistedResult.result,
              );
              mustLoadSkillFirst = false;
            }
            activeSkillPolicy = removeFormInputAfterSubmission(
              tc.name,
              persistedResult.result,
              activeSkillId,
              activeSkillPolicy,
            );
            if (isSubmittedFormInputExecutionResult(tc.name, persistedResult.result)) {
              hasSubmittedFormInputInLoop = true;
              currentRuntimeContext = markSubmittedFormInputRuntimeContext(currentRuntimeContext);
            }
          }
          continue;
        }

        if (tc.providerExecuted === true) {
          await traceProviderExecutedTool({
            mode: "stream",
            agentId: this.id,
            toolName: tc.name,
            toolCallId: tc.id,
            context: {
              toolCallId: tc.id,
              ...toolContext,
              agentId: this.id,
            },
            args: toolCall.args,
          });
          toolCall.status = "completed";
          toolCalls.push(toolCall);
          continue;
        }

        if (capturedInput.parseError) {
          logger.warn("Invalid streamed tool arguments", {
            toolCallId: tc.id,
            error: capturedInput.parseError,
          });

          const dynamic = isDynamicTool(tc.name);
          sendSSE(controller, encoder, {
            type: "tool-input-error",
            toolCallId: tc.id,
            errorText: `Invalid tool arguments: ${capturedInput.parseError}`,
            ...(dynamic ? { dynamic: true } : {}),
          });

          await this.recordToolError(
            toolCall,
            `Invalid tool arguments: ${capturedInput.parseError}`,
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
          continue;
        }

        const policyCheck = enforceSkillPolicy(
          tc.name,
          activeSkillPolicy,
          mustLoadSkillFirst,
          {
            hasSubmittedFormInput: hasSubmittedFormInputInLoop,
            skillToolAvailability: activeSkillToolAvailability,
          },
        );
        if (!policyCheck.allowed) {
          await this.recordToolError(
            toolCall,
            policyCheck.error,
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
          continue;
        }

        try {
          toolCall.status = "executing";
          const startTime = Date.now();
          toolCall.args = applySkillDelegationOverridesToToolInput(
            tc.name,
            toolCall.args,
            activeSkillDelegationOverrides,
          );

          callbacks?.onToolCall?.(toolCall);

          const executionContext = {
            toolCallId: tc.id,
            ...toolContext,
            // Caller identity for capability scoping. Stamped after the
            // spread so caller-supplied context cannot spoof it.
            agentId: this.id,
          };
          const result = await traceConfiguredToolExecution({
            mode: "stream",
            agentId: this.id,
            toolName: tc.name,
            toolCallId: tc.id,
            args: toolCall.args,
            toolsConfig: this.config.tools,
            context: executionContext,
            allowedRemoteToolNames,
            remoteToolSources,
            sourceIntegrationPolicy,
          });
          throwIfAborted(abortSignal);
          await this.notifyToolResult({
            mode: "stream",
            toolName: tc.name,
            toolCallId: tc.id,
            input: toolCall.args,
            result,
            context: executionContext,
          });

          const resultError = getToolResultError(result);
          toolCall.status = resultError === undefined ? "completed" : "error";
          toolCall.result = result;
          toolCall.error = resultError;
          toolCall.executionTime = Date.now() - startTime;
          toolCalls.push(toolCall);

          if (resultError === undefined) {
            // Track skill policy from successful load_skill results
            if (tc.name === LOAD_SKILL_TOOL_ID) {
              activeSkillId = extractSkillId(result);
              activeSkillPolicy = extractSkillPolicy(result);
              activeSkillToolAvailability = extractSkillToolAvailability(result) ??
                INACTIVE_SKILL_TOOL_AVAILABILITY;
              activeSkillDelegationOverrides = extractSkillDelegationOverrides(result);
              mustLoadSkillFirst = false;
            }
            activeSkillPolicy = removeFormInputAfterSubmission(
              tc.name,
              result,
              activeSkillId,
              activeSkillPolicy,
            );
            if (isSubmittedFormInputExecutionResult(tc.name, result)) {
              hasSubmittedFormInputInLoop = true;
              currentRuntimeContext = markSubmittedFormInputRuntimeContext(currentRuntimeContext);
            }
            if (shouldHideProjectToolAfterAgentWriteSuccess(tc.name)) {
              agentWriteFinalResponseToolGuardEnabled = true;
            }
          }

          const dynamic = isDynamicTool(tc.name);
          if (resultError === undefined) {
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: result,
              ...(dynamic ? { dynamic: true } : {}),
            });
          } else {
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: toolCall.id,
              errorText: resultError,
              ...(dynamic ? { dynamic: true } : {}),
            });
          }

          const toolResultMessage = createToolResultMessage(tc.id, tc.name, result);
          if (!currentStepToolResults.has(tc.id)) {
            currentMessages.push(toolResultMessage);
            await this.memory.add(toolResultMessage);
            currentStepToolResults.set(tc.id, toolResultMessage.parts[0] as ToolResultPart);
          }
        } catch (error) {
          const errorStr = error instanceof Error ? error.message : String(error);
          await this.recordToolError(
            toolCall,
            errorStr,
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
        }
      }

      for (const toolResult of finalToolResults.values()) {
        await persistToolResult(toolResult);
      }

      throwIfAborted(abortSignal);
      sendSSE(controller, encoder, { type: "step-end" });
      this.status = "thinking";
    }

    return {
      text: latestAssistantText,
      messages: currentMessages,
      toolCalls,
      status: "completed",
      usage: totalUsage,
      metadata: finalFinishReason ? { finishReason: finalFinishReason } : undefined,
    };
  }

  /**
   * Record a tool error and send SSE event.
   */
  private async recordToolError(
    toolCall: ToolCall,
    errorStr: string,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    currentMessages: Message[],
    toolCalls: ToolCall[],
    options: { emitSse?: boolean } = {},
  ): Promise<void> {
    toolCall.status = "error";
    toolCall.error = errorStr;
    toolCalls.push(toolCall);

    if (options.emitSse !== false) {
      const dynamic = isDynamicTool(toolCall.name);
      sendSSE(controller, encoder, {
        type: "tool-output-error",
        toolCallId: toolCall.id,
        errorText: errorStr,
        ...(dynamic ? { dynamic: true } : {}),
      });
    }

    const errorMessage = createToolErrorMessage(
      toolCall.id,
      toolCall.name,
      errorStr,
    );
    currentMessages.push(errorMessage);
    await this.memory.add(errorMessage);
  }

  /**
   * Resolve system prompt (handle string or function)
   */
  private async resolveSystemPrompt(): Promise<string> {
    const { system } = this.config;
    if (typeof system === "string") return system;
    if (typeof system === "function") return system();
    return "You are a helpful assistant.";
  }

  /**
   * Compute max steps considering edge config and platform limits.
   */
  private computeMaxSteps(platformLimit: number): number {
    const edgeMaxSteps = this.config.edge?.enabled ? this.config.edge.maxSteps : undefined;
    return getMaxSteps(this.config.maxSteps, edgeMaxSteps, platformLimit);
  }

  private resolveTemperature(
    modelString?: string,
    providerOptions?: Record<string, unknown>,
  ): number | undefined {
    return resolveTemperatureParameter(
      modelString,
      this.config.temperature,
      DEFAULT_TEMPERATURE,
      providerOptions,
    );
  }

  private resolveMaxOutputTokens(modelString?: string, maxOutputTokensOverride?: number): number {
    if (
      typeof maxOutputTokensOverride === "number" &&
      Number.isFinite(maxOutputTokensOverride) &&
      maxOutputTokensOverride > 0
    ) {
      return Math.floor(maxOutputTokensOverride);
    }

    // A disabled memory config contributes nothing, exactly like omitting
    // `memory`, so its maxTokens (a conversation-window size) must not cap
    // model output.
    const memoryMaxTokens = this.config.memory?.enabled === false
      ? undefined
      : this.config.memory?.maxTokens;
    return memoryMaxTokens ??
      (modelString ? getModelMaxOutputTokens(modelString) : undefined) ??
      DEFAULT_MAX_TOKENS;
  }

  /**
   * Get memory instance (for advanced use cases)
   */
  getMemory(): Memory<Message> {
    return this.memory;
  }

  /**
   * Get memory stats
   */
  async getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }> {
    return this.memory.getStats();
  }

  /**
   * Clear agent memory
   */
  async clearMemory(): Promise<void> {
    await this.memory.clear();
  }
}
