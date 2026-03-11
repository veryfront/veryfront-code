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
  type ToolCall,
} from "../types.ts";
import { ensureModelReady, findAvailableCloudModel, resolveModel } from "#veryfront/provider";
import { executeTool } from "#veryfront/tool";
import { generateId } from "#veryfront/utils/id.ts";
import { detectPlatform, getPlatformCapabilities } from "#veryfront/platform/core-platform.ts";
import { createMemory, type Memory } from "../memory/index.ts";
import { serverLogger } from "#veryfront/utils";
import {
  addSpanEvent,
  setSpanAttributes,
  withSpan,
} from "#veryfront/observability/tracing/index.ts";
import { convertToModelMessages } from "./model-message-converter.ts";
import { convertToolsToAISDK } from "./model-tool-converter.ts";
import { createStreamState, processStream } from "./ai-stream-handler.ts";
import { MiddlewareChain } from "../middleware/chain.ts";
import { generateText, type LanguageModel, streamText } from "ai";
import { AGENT_DEFAULTS } from "../ai-defaults.ts";

// Re-export from submodules
export { generateMessageId, sendSSE } from "./sse-utils.ts";
export { getAvailableTools, isDynamicTool, parseToolArgs } from "./tool-helpers.ts";
export type { ParsedToolArgs, ToolConfigEntry } from "./tool-helpers.ts";
export { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
export { createStreamState, processStream } from "./ai-stream-handler.ts";
export type { AIStreamCallbacks, AIStreamState, StreamingToolCall } from "./ai-stream-handler.ts";
export {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_STREAM_BUFFER_SIZE,
} from "./constants.ts";

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "./constants.ts";
import { generateMessageId, sendSSE } from "./sse-utils.ts";
import { getAvailableTools, isDynamicTool, parseToolArgs } from "./tool-helpers.ts";
import { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
import {
  filterToolsForSkill,
  isToolAllowedBySkill,
  validateAllowedToolPatterns,
} from "#veryfront/skill/allowed-tools.ts";
import { resolveConfiguredAgentModel } from "./model-resolution.ts";

const logger = serverLogger.component("agent");
const LOAD_SKILL_TOOL_ID = "load-skill";

function getSkillActivationRequiredError(toolName: string): string {
  return `Tool "${toolName}" cannot run before load-skill succeeds in the same step. ` +
    `Call "${LOAD_SKILL_TOOL_ID}" first to establish the active skill context.`;
}

/**
 * Extract and validate the skill policy from a load-skill tool result.
 * Returns `[]` (no tools allowed) for invalid/missing policies instead of
 * `undefined` (no restrictions), preventing accidental policy bypass.
 */
export function extractSkillPolicy(result: unknown): string[] | undefined {
  if (!result || typeof result !== "object") return undefined;
  const skillResult = result as { allowedTools?: unknown };

  // No allowedTools key means the skill has no restrictions
  if (!("allowedTools" in skillResult) || skillResult.allowedTools === undefined) {
    return undefined;
  }

  // Validate the shape: must be a string array
  const raw = skillResult.allowedTools;
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    // Invalid shape — fail closed (empty policy = no tools allowed)
    logger.warn(
      "load-skill returned invalid allowedTools; falling back to empty policy (no tools)",
    );
    return [];
  }

  // Validate each pattern against the regex
  try {
    return validateAllowedToolPatterns(raw);
  } catch (error) {
    logger.warn(
      "load-skill returned invalid tool patterns; falling back to empty policy (no tools)",
      { error },
    );
    return [];
  }
}

/** Result of skill policy enforcement for a single tool call */
type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

/**
 * Enforce skill policy on a single tool call.
 * Shared between generate() and stream() paths.
 */
export function enforceSkillPolicy(
  toolName: string,
  activeSkillPolicy: string[] | undefined,
  mustLoadSkillFirst: boolean,
): SkillPolicyResult {
  // Must load skill before other tools
  if (mustLoadSkillFirst && toolName !== LOAD_SKILL_TOOL_ID) {
    return { allowed: false, error: getSkillActivationRequiredError(toolName) };
  }

  // Check tool allowed by active skill policy (Layer 2: execution-time)
  if (activeSkillPolicy && !isToolAllowedBySkill(toolName, activeSkillPolicy)) {
    return {
      allowed: false,
      error: `Tool "${toolName}" is not allowed by the active skill policy. Allowed: ${
        activeSkillPolicy.join(", ")
      }`,
    };
  }

  return { allowed: true };
}

/**
 * Auto-upgrade a local model string to a cloud provider when API keys are available.
 *
 * Returns the upgraded "provider/model" string, or the original string unchanged
 * if no cloud provider is available. This keeps resolveModel as a pure resolver
 * while the runtime owns the upgrade policy.
 */
function maybeUpgradeLocalModel(modelString: string): string {
  if (!modelString.startsWith("local/")) return modelString;

  const cloud = findAvailableCloudModel();
  if (cloud) {
    logger.info(
      `⚡ Cloud AI API key found — using "${cloud}" instead of local model.`,
    );
    return cloud;
  }
  return modelString;
}

/**
 * Check whether a resolved LanguageModel is a local inference model.
 * Checks the model object properties rather than the requested string,
 * because resolveModel may internally fall back from cloud to local.
 */
function isLocalModel(model: LanguageModel): boolean {
  const m = model as Record<string, unknown>;
  return !!m._isVfLocalModel ||
    m.provider === "local" ||
    (typeof m.modelId === "string" && m.modelId.startsWith("local/"));
}

export class AgentRuntime {
  private id: string;
  private config: AgentConfig;
  private memory: Memory<Message>;
  private status: AgentStatus = "idle";

  constructor(id: string, config: AgentConfig) {
    this.id = id;
    this.config = config;

    const memoryConfig = config.memory ||
      { type: "conversation", maxTokens: AGENT_DEFAULTS.memoryMaxTokens };
    this.memory = createMemory<Message>(memoryConfig);
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(
    input: string | Message[],
    context?: Record<string, unknown>,
    modelOverride?: string,
  ): Promise<AgentResponse> {
    const requestedModel = resolveConfiguredAgentModel(modelOverride || this.config.model);
    const resolvedModelString = maybeUpgradeLocalModel(requestedModel);

    return withSpan("agent.generate", async (span) => {
      setSpanAttributes(span, {
        "agent.id": this.id,
        "agent.model": resolvedModelString,
      });

      const inputMessages = normalizeInput(input);
      for (const msg of inputMessages) await this.memory.add(msg);

      const messages = await this.memory.getMessages();
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
        () => this.executeAgentLoop(systemPrompt, messages, resolvedModelString),
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
    },
    modelOverride?: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const requestedModel = resolveConfiguredAgentModel(modelOverride || this.config.model);
    // Auto-upgrade local/* to a cloud provider when API keys are available.
    const resolvedModelString = maybeUpgradeLocalModel(requestedModel);

    for (const msg of messages) await this.memory.add(msg);

    const memoryMessages = await this.memory.getMessages();
    const systemPrompt = await this.resolveSystemPrompt();

    const encoder = new TextEncoder();
    const toolContext = { agentId: this.id, ...context };
    const textPartId = generateId("text");

    // Resolve model BEFORE creating the ReadableStream — if this throws
    // (e.g., no_ai_available), the error propagates to the caller who can
    // return a proper error response (503) instead of a 200 with an error event.
    const languageModel = resolveModel(resolvedModelString);

    // Determine inference mode from the resolved model object (not the string),
    // because resolveModel may internally fall back from cloud to local.
    const isLocal = isLocalModel(languageModel);

    // Eagerly verify the model runtime is available. For local models this
    // checks that @huggingface/transformers can be imported. Must happen
    // BEFORE creating the ReadableStream so no_ai_available errors propagate
    // to the caller (createChatHandler) who returns a 503 with browser fallback
    // info, instead of being swallowed as an in-band SSE error in a 200 response.
    await ensureModelReady(languageModel);

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
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
          sendSSE(controller, encoder, { type: "text-start", id: textPartId });

          await this.executeAgentLoopStreaming(
            systemPrompt,
            memoryMessages,
            controller,
            encoder,
            callbacks,
            textPartId,
            toolContext,
            resolvedModelString,
            languageModel,
          );

          sendSSE(controller, encoder, { type: "text-end", id: textPartId });
          sendSSE(controller, encoder, { type: "message-finish" });
          controller.close();
        } catch (error) {
          this.status = "error";
          logger.error("Agent stream error", { error });
          sendSSE(controller, encoder, {
            type: "error",
            error: "An internal error occurred",
          });
          controller.close();
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
    modelString?: string,
  ): Promise<AgentResponse> {
    return withSpan("agent.execution_loop", async (loopSpan) => {
      const { maxAgentSteps } = getPlatformCapabilities();
      const maxSteps = this.computeMaxSteps(maxAgentSteps);
      const effectiveModel = resolveConfiguredAgentModel(modelString || this.config.model);
      const languageModel = resolveModel(effectiveModel);

      const toolCalls: ToolCall[] = [];
      const currentMessages = [...messages];
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      // Local models can't reliably do function calling — skip tools gracefully.
      const isLocal = isLocalModel(languageModel);
      if (isLocal && this.config.tools) {
        logger.warn(
          `Agent "${this.id}" has tools configured but is using local model "${effectiveModel}". ` +
            "Local models don't support tool calling — tools will be skipped. " +
            "Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG, or configure " +
            "OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY for full tool support.",
        );
      }

      // Request-scoped skill policy (not class-level mutable state)
      let activeSkillPolicy: string[] | undefined;

      for (let step = 0; step < maxSteps; step++) {
        this.status = "thinking";
        addSpanEvent(loopSpan, "step_start", { step });

        let tools = isLocal ? [] : getAvailableTools(this.config.tools, {
          includeSkillTools: Boolean(this.config.skills),
        });

        // Layer 1: Filter tools based on active skill policy (planning-time)
        if (activeSkillPolicy) {
          tools = filterToolsForSkill(tools, activeSkillPolicy);
        }

        const response = await withSpan("agent.generate_text", async (span) => {
          setSpanAttributes(span, {
            "model.id": effectiveModel,
            "messages.count": currentMessages.length,
          });
          return generateText({
            model: languageModel,
            system: systemPrompt,
            messages: convertToModelMessages(currentMessages),
            tools: convertToolsToAISDK(tools),
            maxOutputTokens: this.config.memory?.maxTokens ?? DEFAULT_MAX_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
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

        if (!response.toolCalls?.length) {
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

          await withSpan("agent.tool_execute", async (toolSpan) => {
            setSpanAttributes(toolSpan, { "tool.name": tc.toolName, "tool.id": tc.toolCallId });

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

              const result = await executeTool(tc.toolName, toolCall.args, { agentId: this.id });

              toolCall.status = "completed";
              toolCall.result = result;
              toolCall.executionTime = Date.now() - startTime;

              // Track skill policy from load-skill results
              if (tc.toolName === LOAD_SKILL_TOOL_ID) {
                activeSkillPolicy = extractSkillPolicy(result);
                mustLoadSkillFirst = false;
              }

              const toolResultMessage: Message = {
                id: `tool_${tc.toolCallId}`,
                role: "tool",
                parts: [
                  {
                    type: "tool-result",
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    result,
                  },
                ],
                timestamp: Date.now(),
              };
              currentMessages.push(toolResultMessage);
              await this.memory.add(toolResultMessage);
            } catch (error) {
              toolCall.status = "error";
              toolCall.error = error instanceof Error ? error.message : String(error);
              setSpanAttributes(toolSpan, { error: true, "error.message": toolCall.error });

              const errorMessage: Message = {
                id: `tool_error_${tc.toolCallId}`,
                role: "tool",
                parts: [
                  {
                    type: "tool-result",
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    result: { error: toolCall.error },
                  },
                ],
                timestamp: Date.now(),
              };
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
   * while consuming AI SDK `streamText()` parts internally.
   */
  private async executeAgentLoopStreaming(
    systemPrompt: string,
    messages: Message[],
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    callbacks?: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
    },
    textPartId?: string,
    toolContext?: Record<string, unknown>,
    modelString?: string,
    resolvedModel?: LanguageModel,
  ): Promise<AgentResponse> {
    const { maxAgentSteps } = getPlatformCapabilities();
    const maxSteps = this.computeMaxSteps(maxAgentSteps);
    const effectiveModel = resolveConfiguredAgentModel(modelString || this.config.model);
    const languageModel = resolvedModel ?? resolveModel(effectiveModel);

    const toolCalls: ToolCall[] = [];
    const currentMessages = [...messages];
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Local models can't reliably do function calling — skip tools gracefully.
    const isLocalStreaming = isLocalModel(languageModel);
    if (isLocalStreaming && this.config.tools) {
      logger.warn(
        `Agent "${this.id}" has tools configured but is using local model "${effectiveModel}". ` +
          "Local models don't support tool calling — tools will be skipped. " +
          "Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG, or configure " +
          "OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY for full tool support.",
      );
    }

    // Request-scoped skill policy (not class-level mutable state)
    let activeSkillPolicy: string[] | undefined;

    for (let step = 0; step < maxSteps; step++) {
      sendSSE(controller, encoder, { type: "step-start" });

      let tools = isLocalStreaming ? [] : getAvailableTools(this.config.tools, {
        includeSkillTools: Boolean(this.config.skills),
      });

      // Layer 1: Filter tools based on active skill policy (planning-time)
      if (activeSkillPolicy) {
        tools = filterToolsForSkill(tools, activeSkillPolicy);
      }

      const result = streamText({
        model: languageModel,
        system: systemPrompt,
        messages: convertToModelMessages(currentMessages),
        tools: convertToolsToAISDK(tools),
        maxOutputTokens: this.config.memory?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
      });

      const state = createStreamState();
      await processStream(result, state, controller, encoder, textPartId, {
        onChunk: callbacks?.onChunk,
        onUsage: (usage) => accumulateUsage(totalUsage, usage),
      });

      const streamParts: MessagePart[] = [];
      if (state.accumulatedText) streamParts.push({ type: "text", text: state.accumulatedText });

      for (const tc of state.toolCalls.values()) {
        const { args, error } = parseToolArgs(tc.arguments);
        if (error) {
          logger.warn("Failed to parse streamed tool arguments", {
            toolCallId: tc.id,
            error,
          });
        }
        streamParts.push({
          type: `tool-${tc.name}`,
          toolCallId: tc.id,
          toolName: tc.name,
          args,
        });
      }

      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${step}`,
        role: "assistant",
        parts: streamParts,
        timestamp: Date.now(),
      };
      currentMessages.push(assistantMessage);
      await this.memory.add(assistantMessage);

      if (state.finishReason !== "tool-calls" || !state.toolCalls.size) {
        sendSSE(controller, encoder, { type: "step-end" });
        break;
      }

      this.status = "tool_execution";
      const streamedToolCalls = Array.from(state.toolCalls.values());
      let mustLoadSkillFirst = !activeSkillPolicy &&
        Boolean(this.config.skills) &&
        streamedToolCalls.some((tc) => tc.name === LOAD_SKILL_TOOL_ID);

      for (const tc of streamedToolCalls) {
        const { args, error: argError } = parseToolArgs(tc.arguments);
        const toolCall: ToolCall = { id: tc.id, name: tc.name, args, status: "pending" };

        if (argError) {
          logger.warn("Invalid streamed tool arguments", {
            toolCallId: tc.id,
            error: argError,
          });

          const dynamic = isDynamicTool(tc.name);
          sendSSE(controller, encoder, {
            type: "tool-input-error",
            toolCallId: tc.id,
            errorText: `Invalid tool arguments: ${argError}`,
            ...(dynamic ? { dynamic: true } : {}),
          });

          await this.recordToolError(
            toolCall,
            `Invalid tool arguments: ${argError}`,
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

          callbacks?.onToolCall?.(toolCall);

          const result = await executeTool(tc.name, toolCall.args, {
            agentId: this.id,
            ...toolContext,
          });

          toolCall.status = "completed";
          toolCall.result = result;
          toolCall.executionTime = Date.now() - startTime;
          toolCalls.push(toolCall);

          // Track skill policy from load-skill results
          if (tc.name === LOAD_SKILL_TOOL_ID) {
            activeSkillPolicy = extractSkillPolicy(result);
            mustLoadSkillFirst = false;
          }

          const dynamic = isDynamicTool(tc.name);
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: toolCall.id,
            output: result,
            ...(dynamic ? { dynamic: true } : {}),
          });

          const toolResultMessage: Message = {
            id: `tool_${tc.id}`,
            role: "tool",
            parts: [
              {
                type: "tool-result",
                toolCallId: tc.id,
                toolName: tc.name,
                result,
              },
            ],
            timestamp: Date.now(),
          };
          currentMessages.push(toolResultMessage);
          await this.memory.add(toolResultMessage);
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

      sendSSE(controller, encoder, { type: "step-end" });
      this.status = "thinking";
    }

    const lastMessage = currentMessages[currentMessages.length - 1];
    return {
      text: lastMessage ? getTextFromParts(lastMessage.parts) : "",
      messages: currentMessages,
      toolCalls,
      status: "completed",
      usage: totalUsage,
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
  ): Promise<void> {
    toolCall.status = "error";
    toolCall.error = errorStr;
    toolCalls.push(toolCall);

    const dynamic = isDynamicTool(toolCall.name);
    sendSSE(controller, encoder, {
      type: "tool-output-error",
      toolCallId: toolCall.id,
      errorText: errorStr,
      ...(dynamic ? { dynamic: true } : {}),
    });

    const errorMessage: Message = {
      id: `tool_error_${toolCall.id}`,
      role: "tool",
      parts: [
        {
          type: "tool-result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: { error: errorStr },
        },
      ],
      timestamp: Date.now(),
    };
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
    return "You are a helpful AI assistant.";
  }

  /**
   * Compute max steps considering edge config and platform limits.
   */
  private computeMaxSteps(platformLimit: number): number {
    const edgeMaxSteps = this.config.edge?.enabled ? this.config.edge.maxSteps : undefined;
    return getMaxSteps(this.config.maxSteps, edgeMaxSteps, platformLimit);
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
