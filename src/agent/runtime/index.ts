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
  setSpanAttributes,
  withSpan,
} from "#veryfront/observability/tracing/index.ts";
import { convertToTextGenerationRuntimeMessages } from "./text-generation-runtime-message-converter.ts";
import { convertToolsToRuntimeTools } from "./model-tool-converter.ts";
import { resolveProviderOptionsWithDefaults } from "./default-provider-options.ts";
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
  extractSkillPolicy,
  hydrateActiveSkillStateFromMessages,
  LOAD_SKILL_TOOL_ID,
} from "./skill-policy-enforcement.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderTools,
} from "./runtime-tool-config.ts";

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
export {
  enforceSkillPolicy,
  extractSkillPolicy,
  type SkillPolicyResult,
} from "./skill-policy-enforcement.ts";

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, getModelMaxOutputTokens } from "./constants.ts";
import { closeSSEStream, generateMessageId, sendSSE } from "./sse-utils.ts";
import { executeConfiguredTool, getAvailableTools, isDynamicTool } from "./tool-helpers.ts";
import { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
import { filterToolsForSkill } from "#veryfront/skill/allowed-tools.ts";
import { resolveConfiguredAgentModel, resolveRuntimeModel } from "./model-resolution.ts";
import type { RuntimeGenerateToolResult } from "./runtime-tool-types.ts";
import { stringifyToolError, throwIfAborted } from "./error-utils.ts";
import { supportsTemperatureParameter } from "./model-capabilities.ts";
import {
  applySkillDelegationOverridesToToolInput,
  extractSkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";

const logger = serverLogger.component("agent");

function isAbortError(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted && error === abortSignal.reason) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function warnLocalToolSkipping(agentId: string, modelId: string): void {
  logger.warn(
    `Agent "${agentId}" has tools configured but is using local model "${modelId}". ` +
      "Local models don't support tool calling — tools will be skipped. " +
      "Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG, or configure " +
      "OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY for full tool support.",
  );
}

type ResolvedModelTransport = {
  requestedModel: string;
  resolvedModelString: string;
  languageModel: ModelRuntime;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
};

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

  private async resolveModelTransport(
    context: Record<string, unknown> | undefined,
    modelOverride: string | undefined,
    mode: "generate" | "stream",
  ): Promise<ResolvedModelTransport> {
    const requestedModel = resolveConfiguredAgentModel(modelOverride || this.config.model);
    const resolvedModelString = resolveRuntimeModel(modelOverride || this.config.model);
    const transport = await this.config.resolveModelTransport?.({
      agentId: this.id,
      requestedModel,
      resolvedModel: resolvedModelString,
      context,
      mode,
    });

    return {
      requestedModel,
      resolvedModelString,
      languageModel: transport?.model ?? resolveModel(resolvedModelString),
      headers: transport?.headers,
      providerOptions: resolveProviderOptionsWithDefaults(
        resolvedModelString,
        transport?.providerOptions,
      ),
    };
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
  ): Promise<AgentResponse> {
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
      for (const msg of inputMessages) await this.memory.add(msg);
      // Configured memory returns the full persisted conversation (this turn +
      // history). The stateless default persists nothing, so fall back to this
      // turn's input — each call then runs in isolation, keeping concurrent
      // calls on a shared instance from mixing into one conversation.
      const persisted = await this.memory.getMessages();
      const messages = persisted.length > 0 ? persisted : inputMessages;

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
            maxOutputTokensOverride,
            requestedModel,
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

    for (const msg of messages) await this.memory.add(msg);
    // Configured memory returns the full persisted conversation (this turn +
    // history). The stateless default persists nothing, so fall back to this
    // turn's input — concurrent streams on a shared instance then stay isolated
    // instead of interleaving into one conversation.
    const persisted = await this.memory.getMessages();
    const memoryMessages = persisted.length > 0 ? persisted : messages;

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

    // Resolve model BEFORE creating the ReadableStream — if this throws
    // (e.g., no_ai_available), the error propagates to the caller who can
    // return a proper error response (503) instead of a 200 with an error event.
    const languageModel = transport.languageModel;

    // Determine inference mode from the resolved model object (not the string),
    // because resolveModel may internally fall back from cloud to local.
    const isLocal = isLocalModelRuntime(languageModel);

    // Eagerly verify the model runtime is available. For local models this
    // checks that @huggingface/transformers can be imported. Must happen
    // BEFORE creating the ReadableStream so no_ai_available errors propagate
    // to the route handler, which returns a 503 with browser fallback info
    // instead of swallowing it as an in-band SSE error in a 200 response.
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
    // that await settles, leaving the rejection without a consumer — fatal as
    // an unhandled rejection under Deno (#2334).
    let inFlight: Promise<AgentResponse> | undefined;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          throwIfAborted(streamAbortSignal);
          this.status = "streaming";

          const messageId = generateMessageId();
          sendSSE(controller, encoder, { type: "message-start", messageId });
          // Report the effective model — when resolveModel falls back from
          // cloud to local (e.g. missing API key), use the resolved object's
          // modelId so the client avatar matches the actual provider.
          const effectiveModel = isLocal && !resolvedModelString.startsWith("local/")
            ? `local/${(languageModel as Record<string, unknown>).modelId ?? "unknown"}`
            : resolvedModelString;
          sendSSE(controller, encoder, {
            type: "data",
            data: {
              inferenceMode: isLocal ? "server-local" : "cloud",
              model: effectiveModel,
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
                maxOutputTokensOverride,
                streamAbortSignal,
                requestedModel,
              ),
          );
          const response = await inFlight;
          throwIfAborted(streamAbortSignal);
          callbacks?.onFinish?.(response);
          throwIfAborted(streamAbortSignal);

          sendSSE(controller, encoder, { type: "message-finish" });
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
    maxOutputTokensOverride?: number,
    temperatureModelString?: string,
  ): Promise<AgentResponse> {
    return withSpan("agent.execution_loop", async (loopSpan) => {
      const { maxAgentSteps } = getPlatformCapabilities();
      const maxSteps = this.computeMaxSteps(maxAgentSteps);
      const effectiveModel = resolveRuntimeModel(modelString || this.config.model);
      const languageModel = resolvedModel ?? resolveModel(effectiveModel);

      const toolCalls: ToolCall[] = [];
      const currentMessages = [...messages];
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      // Local models can't reliably do function calling — skip tools gracefully.
      const isLocal = isLocalModelRuntime(languageModel);
      if (isLocal && this.config.tools) {
        warnLocalToolSkipping(this.id, effectiveModel);
      }

      // Request-scoped skill policy (not class-level mutable state)
      const hydratedSkillState = hydrateActiveSkillStateFromMessages(currentMessages);
      let activeSkillPolicy = hydratedSkillState.activeSkillPolicy;
      let activeSkillDelegationOverrides = hydratedSkillState.activeSkillDelegationOverrides;
      const allowedRemoteToolNames = getRuntimeAllowedRemoteTools(this.config);
      const providerTools = getRuntimeProviderTools(this.config);
      const forwardedRemoteToolDefinitions = getRuntimeForwardedIntegrationToolDefs(this.config);
      const remoteToolSources = getRuntimeRemoteToolSources(this.config);
      let currentSystemPrompt = systemPrompt;
      let currentRuntimeContext = runtimeContext;

      for (let step = 0; step < maxSteps; step++) {
        this.status = "thinking";
        addSpanEvent(loopSpan, "step_start", { step });

        const runtimeState = await this.resolveRuntimeState(
          currentMessages,
          currentRuntimeContext,
          "generate",
          step,
          currentSystemPrompt,
        );
        currentSystemPrompt = runtimeState.systemPrompt;
        currentRuntimeContext = runtimeState.context;
        const toolContext = { ...toolContextBase, ...currentRuntimeContext };

        let tools = isLocal ? [] : await getAvailableTools(this.config.tools, {
          includeSkillTools: Boolean(this.config.skills),
          allowedRemoteToolNames,
          forwardedRemoteToolDefinitions,
          remoteToolSources,
          remoteToolContext: toolContext,
        });

        // Layer 1: Filter tools based on active skill policy (planning-time)
        if (activeSkillPolicy) {
          tools = filterToolsForSkill(tools, activeSkillPolicy);
        }

        const temperature = this.resolveTemperature(temperatureModelString ?? effectiveModel);
        const response = await withSpan("agent.generate_text", async (span) => {
          setSpanAttributes(span, {
            "model.id": effectiveModel,
            "messages.count": currentMessages.length,
          });
          return generateText({
            model: languageModel,
            system: currentSystemPrompt,
            messages: convertToTextGenerationRuntimeMessages(currentMessages),
            tools: convertToolsToRuntimeTools(tools, {
              model: effectiveModel,
              providerTools,
            }),
            experimental_repairToolCall: repairToolCall,
            maxOutputTokens: this.resolveMaxOutputTokens(effectiveModel, maxOutputTokensOverride),
            ...(temperature === undefined ? {} : { temperature }),
            ...(headers ? { headers } : {}),
            ...(providerOptions ? { providerOptions } : {}),
          });
        });

        // Accumulate usage
        if (response.usage) {
          const input = response.usage.inputTokens ?? 0;
          const output = response.usage.outputTokens ?? 0;
          accumulateUsage(totalUsage, {
            promptTokens: input,
            completionTokens: output,
            totalTokens: input + output,
          });
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
        };

        if (!response.toolCalls?.length) {
          for (const generatedToolResult of generatedToolResults.values()) {
            await persistGeneratedToolResult(generatedToolResult);
          }
          this.status = "completed";
          addSpanEvent(loopSpan, "loop_complete");
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
          Boolean(this.config.skills) &&
          response.toolCalls.some((tc) => tc.toolName === LOAD_SKILL_TOOL_ID);

        for (const tc of response.toolCalls) {
          const toolCall: ToolCall = {
            id: tc.toolCallId,
            name: tc.toolName,
            args: tc.input as Record<string, unknown>,
            status: "pending",
          };
          const generatedToolResult = generatedToolResults.get(tc.toolCallId);

          await withSpan("agent.tool_execute", async (toolSpan) => {
            setSpanAttributes(toolSpan, { "tool.name": tc.toolName, "tool.id": tc.toolCallId });

            if (generatedToolResult) {
              await persistGeneratedToolResult(generatedToolResult);
              toolCall.status = generatedToolResult.isError === true ? "error" : "completed";
              toolCall.result = generatedToolResult.result;
              toolCall.error = generatedToolResult.isError === true
                ? stringifyToolError(generatedToolResult.result)
                : undefined;
              toolCalls.push(toolCall);
              return;
            }

            const policyCheck = enforceSkillPolicy(
              tc.toolName,
              activeSkillPolicy,
              mustLoadSkillFirst,
            );
            if (!policyCheck.allowed) {
              toolCall.status = "error";
              toolCall.error = policyCheck.error;

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
              };
              const result = await executeConfiguredTool(
                tc.toolName,
                toolCall.args,
                this.config.tools,
                executionContext,
                allowedRemoteToolNames,
                remoteToolSources,
              );
              await this.notifyToolResult({
                mode: "generate",
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                input: toolCall.args,
                result,
                context: executionContext,
              });

              toolCall.status = "completed";
              toolCall.result = result;
              toolCall.executionTime = Date.now() - startTime;

              // Track skill policy from load_skill results
              if (tc.toolName === LOAD_SKILL_TOOL_ID) {
                activeSkillPolicy = extractSkillPolicy(result);
                activeSkillDelegationOverrides = extractSkillDelegationOverrides(result);
                mustLoadSkillFirst = false;
              }

              const toolResultMessage = createToolResultMessage(
                tc.toolCallId,
                tc.toolName,
                result,
              );
              currentMessages.push(toolResultMessage);
              await this.memory.add(toolResultMessage);
            } catch (error) {
              toolCall.status = "error";
              toolCall.error = error instanceof Error ? error.message : String(error);
              setSpanAttributes(toolSpan, { error: true, "error.message": toolCall.error });

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
        }
      }

      this.status = "completed";
      addSpanEvent(loopSpan, "max_steps_reached", { maxSteps });

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

    // Local models can't reliably do function calling — skip tools gracefully.
    const isLocalStreaming = isLocalModelRuntime(languageModel);
    if (isLocalStreaming && this.config.tools) {
      warnLocalToolSkipping(this.id, effectiveModel);
    }

    // Request-scoped skill policy (not class-level mutable state)
    const hydratedSkillState = hydrateActiveSkillStateFromMessages(currentMessages);
    let activeSkillPolicy = hydratedSkillState.activeSkillPolicy;
    let activeSkillDelegationOverrides = hydratedSkillState.activeSkillDelegationOverrides;
    let finalFinishReason: string | undefined;
    let latestAssistantText = "";
    const allowedRemoteToolNames = getRuntimeAllowedRemoteTools(this.config);
    const providerTools = getRuntimeProviderTools(this.config);
    const forwardedRemoteToolDefinitions = getRuntimeForwardedIntegrationToolDefs(this.config);
    const remoteToolSources = getRuntimeRemoteToolSources(this.config);
    let currentSystemPrompt = systemPrompt;
    let currentRuntimeContext = runtimeContext;

    for (let step = 0; step < maxSteps; step++) {
      throwIfAborted(abortSignal);
      sendSSE(controller, encoder, { type: "step-start" });
      const currentStepToolResults = new Map<string, ToolResultPart>();

      const runtimeState = await this.resolveRuntimeState(
        currentMessages,
        currentRuntimeContext,
        "stream",
        step,
        currentSystemPrompt,
      );
      currentSystemPrompt = runtimeState.systemPrompt;
      currentRuntimeContext = runtimeState.context;
      const toolContext = { ...toolContextBase, ...currentRuntimeContext };

      let tools = isLocalStreaming ? [] : await getAvailableTools(this.config.tools, {
        includeSkillTools: Boolean(this.config.skills),
        allowedRemoteToolNames,
        forwardedRemoteToolDefinitions,
        remoteToolSources,
        remoteToolContext: toolContext,
      });

      // Layer 1: Filter tools based on active skill policy (planning-time)
      if (activeSkillPolicy) {
        tools = filterToolsForSkill(tools, activeSkillPolicy);
      }

      const runtimeTools = convertToolsToRuntimeTools(tools, {
        model: effectiveModel,
        providerTools,
      });

      const temperature = this.resolveTemperature(temperatureModelString ?? effectiveModel);
      const result = streamText({
        model: languageModel,
        system: currentSystemPrompt,
        messages: convertToTextGenerationRuntimeMessages(currentMessages),
        tools: runtimeTools,
        experimental_repairToolCall: repairToolCall,
        maxOutputTokens: this.resolveMaxOutputTokens(effectiveModel, maxOutputTokensOverride),
        ...(temperature === undefined ? {} : { temperature }),
        ...(headers ? { headers } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        abortSignal,
      });

      const state = createStreamState();
      await processStream(result, state, controller, encoder, textPartId, {
        onChunk: callbacks?.onChunk,
        onUsage: (usage) => accumulateUsage(totalUsage, usage),
        providerExecutedToolNames: getProviderExecutedToolNames(runtimeTools),
      }, abortSignal);
      throwIfAborted(abortSignal);
      finalFinishReason = state.finishReason ?? finalFinishReason;

      const streamParts: MessagePart[] = [];
      for (const reasoningPart of state.reasoningParts) {
        if (
          reasoningPart.text.length === 0 &&
          !reasoningPart.signature &&
          !reasoningPart.redactedData
        ) {
          continue;
        }
        streamParts.push({
          type: "reasoning",
          ...(reasoningPart.text.length > 0 ? { text: reasoningPart.text } : {}),
          ...(reasoningPart.signature ? { signature: reasoningPart.signature } : {}),
          ...(reasoningPart.redactedData ? { redactedData: reasoningPart.redactedData } : {}),
        });
      }
      if (state.accumulatedText) streamParts.push({ type: "text", text: state.accumulatedText });

      for (const tc of state.toolCalls.values()) {
        const materialized = materializeStreamedToolCall(tc);
        streamParts.push(materialized.part);

        if (materialized.kind === "incomplete" && isRecoverablePlaceholderToolCall(tc)) {
          // Provisional empty-object placeholder that never finalized. The
          // model never committed arguments; the loop will recover by
          // re-calling the model. Persist the (empty) part for transparent
          // history but surface no termination warning or error.
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

      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${step}`,
        role: "assistant",
        parts: streamParts,
        timestamp: Date.now(),
      };
      latestAssistantText = getTextFromParts(assistantMessage.parts);
      currentMessages.push(assistantMessage);
      await this.memory.add(assistantMessage);

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
        Boolean(this.config.skills) &&
        streamedToolCalls.some((tc) => tc.name === LOAD_SKILL_TOOL_ID);

      for (const tc of streamedToolCalls) {
        throwIfAborted(abortSignal);
        if (isRecoverablePlaceholderToolCall(tc)) {
          // Provisional empty-object placeholder that never finalized. The
          // model never committed arguments, so we neither execute it nor
          // surface a stream-termination error — the loop continues and the
          // next model call recovers the real tool call.
          continue;
        }
        if (isStreamedToolCallIncomplete(tc)) {
          // Stream ended before the provider finalized this tool call. We
          // cannot execute it — record a distinct stream-termination error
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
          continue;
        }

        if (persistedResult) {
          const persistedError = getToolResultError(persistedResult.result);
          toolCall.status = persistedError === undefined ? "completed" : "error";
          toolCall.result = persistedResult.result;
          toolCall.error = persistedError;
          toolCalls.push(toolCall);
          continue;
        }

        if (tc.providerExecuted === true) {
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

        const policyCheck = enforceSkillPolicy(tc.name, activeSkillPolicy, mustLoadSkillFirst);
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
          };
          const result = await executeConfiguredTool(
            tc.name,
            toolCall.args,
            this.config.tools,
            executionContext,
            allowedRemoteToolNames,
            remoteToolSources,
          );
          throwIfAborted(abortSignal);
          await this.notifyToolResult({
            mode: "stream",
            toolName: tc.name,
            toolCallId: tc.id,
            input: toolCall.args,
            result,
            context: executionContext,
          });

          toolCall.status = "completed";
          toolCall.result = result;
          toolCall.executionTime = Date.now() - startTime;
          toolCalls.push(toolCall);

          // Track skill policy from load_skill results
          if (tc.name === LOAD_SKILL_TOOL_ID) {
            activeSkillPolicy = extractSkillPolicy(result);
            activeSkillDelegationOverrides = extractSkillDelegationOverrides(result);
            mustLoadSkillFirst = false;
          }

          const dynamic = isDynamicTool(tc.name);
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: toolCall.id,
            output: result,
            ...(dynamic ? { dynamic: true } : {}),
          });

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

  private resolveTemperature(modelString?: string): number | undefined {
    if (!supportsTemperatureParameter(modelString)) {
      return undefined;
    }
    return this.config.temperature ?? DEFAULT_TEMPERATURE;
  }

  private resolveMaxOutputTokens(modelString?: string, maxOutputTokensOverride?: number): number {
    if (
      typeof maxOutputTokensOverride === "number" &&
      Number.isFinite(maxOutputTokensOverride) &&
      maxOutputTokensOverride > 0
    ) {
      return Math.floor(maxOutputTokensOverride);
    }

    return this.config.memory?.maxTokens ??
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
