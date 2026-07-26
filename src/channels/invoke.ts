/**
 * Signed channel-invocation schemas, discovery helpers, and execution adapter.
 *
 * @module channels/invoke
 *
 * @example Verify and validate a channel payload before execution
 * ```ts
 * import {
 *   ChannelInvokeRequestSchema,
 *   verifyDispatchJws,
 * } from "veryfront/channels/invoke";
 *
 * await verifyDispatchJws(jws, rawBody, {
 *   audience: "project-slug",
 *   expectedProjectId: "project-id",
 *   expectedPlatform: "slack",
 *   maxAgeSeconds: 60,
 *   publicKeyPem,
 * });
 * const payload = ChannelInvokeRequestSchema.parse(JSON.parse(rawBody));
 * ```
 */
import type { Agent, AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { fromError } from "#veryfront/errors";
import type { HandlerContext } from "#veryfront/types";
import { serverLogger } from "#veryfront/utils";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  getAgent as getRegisteredAgent,
  getAllAgentIds as getRegisteredAgentIds,
} from "../agent/composition/composition.ts";
import { listRuntimeAgents, type RuntimeAgentDiscoveryDeps } from "./control-plane.ts";
import { ensureProjectDiscovery as ensureProjectDiscoveryForProject } from "#veryfront/server/handlers/request/api/project-discovery.ts";

const logger = serverLogger.component("channels-invoke");
const MAX_PERSISTENT_AGENT_INVOCATIONS = 32;
const MAX_CHANNEL_RESPONSE_MESSAGES = 1_000;
const MAX_CHANNEL_RESPONSE_MESSAGE_PARTS = 1_000;
const MAX_CHANNEL_RESPONSE_TOOL_CALLS = 256;
const MAX_DISCOVERED_AGENT_IDS_IN_LOG = 50;

interface PersistentAgentInvocationState {
  pending: number;
  tail: Promise<void>;
}

const persistentAgentInvocations = new WeakMap<Agent, PersistentAgentInvocationState>();

const getRawHistoryPartSchema = defineSchema((v) =>
  v.object({
    type: v.string(),
  }).passthrough()
);

const getChannelAttachmentSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    kind: v.enum(["image", "file"]),
    filename: v.string().optional(),
    mediaType: v.string().optional(),
    privateUrl: v.string().optional(),
  })
);

const getChannelInvokeHistoryMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    parts: v.array(getRawHistoryPartSchema()),
    metadata: v.record(v.string(), v.unknown()).optional(),
    createdAt: v.string().datetime().optional(),
  })
);

const getChannelInvokeRequestWireSchema = defineSchema((v) =>
  v.object({
    dispatchId: v.string().min(1),
    conversationId: v.string().min(1),
    projectId: v.string().min(1),
    assistantId: v.string().min(1),
    platform: v.literal("slack"),
    inboundMessage: v.object({
      text: v.string(),
      userId: v.string(),
      userName: v.string(),
      isDirectMessage: v.boolean(),
      attachments: v.array(getChannelAttachmentSchema()).optional(),
    }),
    conversationHistory: v.array(getChannelInvokeHistoryMessageSchema()),
    generation: v.object({
      maxResponseTokens: v.number().int().positive().max(16384).optional(),
    }).optional(),
  })
);

/** Zod schema for get channel invoke request. */
export const getChannelInvokeRequestSchema = getChannelInvokeRequestWireSchema;
/** Zod schema for channel invoke request. */
export const ChannelInvokeRequestSchema = lazySchema(getChannelInvokeRequestSchema);

/** Zod schema for get channel assistants request. */
export const getChannelAssistantsRequestSchema = defineSchema((v) =>
  v.object({
    requestId: v.string().min(1),
    projectId: v.string().min(1),
    platform: v.literal("slack"),
  })
);
/** Zod schema for channel assistants request. */
export const ChannelAssistantsRequestSchema = lazySchema(getChannelAssistantsRequestSchema);

/** Zod schema for get channel assistant. */
export const getChannelAssistantSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string().nullable().optional(),
    model: v.string().nullable().optional(),
  })
);
/** Zod schema for channel assistant. */
export const ChannelAssistantSchema = lazySchema(getChannelAssistantSchema);

/** Zod schema for get channel assistants response. */
export const getChannelAssistantsResponseSchema = defineSchema((v) =>
  v.object({
    assistants: v.array(getChannelAssistantSchema()),
  })
);
/** Zod schema for channel assistants response. */
export const ChannelAssistantsResponseSchema = lazySchema(getChannelAssistantsResponseSchema);

const getChannelTextPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("text"),
    text: v.string(),
  })
);
const channelTextPartSchema = lazySchema(getChannelTextPartSchema);

const getChannelToolCallPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("tool_call"),
    id: v.string(),
    name: v.string(),
    input: v.record(v.string(), v.unknown()),
    state: v.enum(["streaming", "pending", "completed", "error"]),
  })
);
const channelToolCallPartSchema = lazySchema(getChannelToolCallPartSchema);

const getChannelToolResultPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("tool_result"),
    tool_call_id: v.string(),
    output: v.unknown(),
    is_error: v.boolean().optional(),
  })
);
const channelToolResultPartSchema = lazySchema(getChannelToolResultPartSchema);

const getChannelReasoningPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("reasoning"),
    text: v.string(),
  })
);
const channelReasoningPartSchema = lazySchema(getChannelReasoningPartSchema);

const getChannelErrorPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("error"),
    code: v.string(),
    message: v.string(),
  })
);

/** Zod schema for get channel response part. */
export const getChannelResponsePartSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    getChannelTextPartSchema(),
    getChannelToolCallPartSchema(),
    getChannelToolResultPartSchema(),
    getChannelReasoningPartSchema(),
    getChannelErrorPartSchema(),
  ])
);
/** Zod schema for channel response part. */
export const ChannelResponsePartSchema = lazySchema(getChannelResponsePartSchema);

/** Zod schema for get channel invoke response. */
export const getChannelInvokeResponseSchema = defineSchema((v) =>
  v.object({
    ignored: v.boolean(),
    responseParts: v.array(getChannelResponsePartSchema()).optional(),
    tokenUsage: v.object({
      inputTokens: v.number().int().nonnegative().optional(),
      outputTokens: v.number().int().nonnegative().optional(),
      totalTokens: v.number().int().nonnegative().optional(),
      cachedInputTokens: v.number().int().nonnegative().optional(),
      cacheCreationInputTokens: v.number().int().nonnegative().optional(),
      cacheReadInputTokens: v.number().int().nonnegative().optional(),
      reasoningTokens: v.number().int().nonnegative().optional(),
    }).optional(),
    error: v.object({
      code: v.enum(["provider_error", "internal_error"]),
      retryable: v.boolean(),
    }).optional(),
  })
);
/** Zod schema for channel invoke response. */
export const ChannelInvokeResponseSchema = lazySchema(getChannelInvokeResponseSchema);

/** Request payload for channel invoke. */
export type ChannelInvokeRequest = InferSchema<ReturnType<typeof getChannelInvokeRequestSchema>>;
/** Response payload for channel invoke. */
export type ChannelInvokeResponse = InferSchema<ReturnType<typeof getChannelInvokeResponseSchema>>;
/** Request payload for channel assistants. */
export type ChannelAssistantsRequest = InferSchema<
  ReturnType<typeof getChannelAssistantsRequestSchema>
>;
/** Response payload for channel assistants. */
export type ChannelAssistantsResponse = InferSchema<
  ReturnType<typeof getChannelAssistantsResponseSchema>
>;

/** Public API contract for channel response part. */
type ChannelResponsePart = InferSchema<ReturnType<typeof getChannelResponsePartSchema>>;
/** Public API contract for channel invoke deps. */
export interface ChannelInvokeDeps extends RuntimeAgentDiscoveryDeps {}

/** Shared default channel invoke deps value. */
export const defaultChannelInvokeDeps: ChannelInvokeDeps = {
  ensureProjectDiscovery: ensureProjectDiscoveryForProject,
  getAgent: getRegisteredAgent,
  getAllAgentIds: getRegisteredAgentIds,
};

/** List channel assistants. */
export async function listChannelAssistants(
  ctx: HandlerContext,
  deps: ChannelInvokeDeps,
): Promise<ChannelAssistantsResponse> {
  const response = await listRuntimeAgents(ctx, deps);
  const assistants = response.agents.map((agent) =>
    ChannelAssistantSchema.parse({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? null,
      model: agent.model ?? null,
    })
  );

  return ChannelAssistantsResponseSchema.parse({ assistants });
}
export { verifyDispatchJws, verifyDispatchJwsSignature } from "./control-plane.ts";

function normalizeConversationPart(
  part: InferSchema<ReturnType<typeof getRawHistoryPartSchema>>,
  toolNamesById: ReadonlyMap<string, string> = new Map(),
): Message["parts"][number] | null {
  if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
    return { type: "text", text: part.text };
  }

  if (
    part.type === "tool_call" &&
    typeof part.id === "string" &&
    part.id.length > 0 &&
    typeof part.name === "string" &&
    part.name.length > 0 &&
    part.input &&
    typeof part.input === "object" &&
    !Array.isArray(part.input) &&
    !toolNamesById.has(part.id)
  ) {
    return {
      type: `tool-${part.name}`,
      toolCallId: part.id,
      toolName: part.name,
      args: snapshotJsonRecord(part.input, "Channel history tool input"),
    };
  }

  if (
    part.type === "tool_result" &&
    typeof part.tool_call_id === "string" &&
    part.tool_call_id.length > 0
  ) {
    const toolName = typeof part.tool_name === "string" && part.tool_name.length > 0
      ? part.tool_name
      : toolNamesById.get(part.tool_call_id);
    if (!toolName) return null;

    return {
      type: "tool-result",
      toolCallId: part.tool_call_id,
      toolName,
      result: "output" in part
        ? snapshotJsonValue(part.output, "Channel history tool result")
        : undefined,
    };
  }

  return null;
}

/** Normalizes conversation history for runtime. */
export function normalizeConversationHistoryForRuntime(
  messages: ChannelInvokeRequest["conversationHistory"],
): Message[] {
  const toolNamesById = new Map<string, string>();

  return messages.map((message): Message => {
    if (message.role === "user" || message.role === "system") {
      toolNamesById.clear();
    }

    const parts = message.parts
      .map((part) => {
        const normalizedPart = normalizeConversationPart(part, toolNamesById);
        if (
          normalizedPart?.type !== "tool-result" && normalizedPart && "toolCallId" in normalizedPart
        ) {
          toolNamesById.set(normalizedPart.toolCallId, normalizedPart.toolName);
        }
        return normalizedPart;
      })
      .filter((part): part is NonNullable<typeof part> => part !== null);

    const timestamp = message.createdAt === undefined ? undefined : Date.parse(message.createdAt);

    return {
      id: message.id,
      role: message.role,
      parts,
      ...(timestamp !== undefined && Number.isFinite(timestamp) ? { timestamp } : {}),
      ...(message.metadata
        ? { metadata: snapshotJsonRecord(message.metadata, "Channel history metadata") }
        : {}),
    };
  });
}

/** Resolves channel invoke agent. */
export function resolveChannelInvokeAgent(
  assistantId: string,
  deps: Pick<ChannelInvokeDeps, "getAgent">,
): Agent | undefined {
  return deps.getAgent(assistantId);
}

function toChannelToolCallState(status: string): "pending" | "completed" | "error" {
  switch (status) {
    case "completed":
      return "completed";
    case "error":
      return "error";
    default:
      return "pending";
  }
}

function snapshotJsonValue(value: unknown, label: string): BoundedJsonValue {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) {
    throw new TypeError(`${label} must be an acyclic, bounded, data-only JSON value`);
  }
  return snapshot.value;
}

function snapshotJsonRecord(value: unknown, label: string): Record<string, BoundedJsonValue> {
  const snapshot = snapshotJsonValue(value, label);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return snapshot;
}

function convertAssistantPartToChannelResponsePart(
  part: Message["parts"][number],
  knownToolCallIds: Set<string>,
): ChannelResponsePart | null {
  if (
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string" &&
    part.text.trim().length > 0
  ) {
    return channelTextPartSchema.parse({
      type: "text",
      text: part.text,
    });
  }

  // A tool-call part carries `toolCallId`; `tool-result` and any future
  // `tool-*` parts that aren't calls do not. The structural check guards
  // against misclassifying new `tool-*` part types as tool calls.
  const isToolCallPart = (
    part.type === "tool-call" ||
    (part.type.startsWith("tool-") && part.type !== "tool-result")
  ) && "toolCallId" in part;
  if (
    isToolCallPart &&
    "toolCallId" in part &&
    "toolName" in part &&
    !knownToolCallIds.has(part.toolCallId)
  ) {
    return channelToolCallPartSchema.parse({
      type: "tool_call",
      id: part.toolCallId,
      name: part.toolName,
      input: snapshotJsonRecord(
        "args" in part ? part.args : ("input" in part ? part.input : {}),
        "Channel assistant tool input",
      ),
      state: "pending",
    });
  }

  return null;
}

function findLastAssistantMessage(messages: Message[]): Message | undefined {
  if (messages.length > MAX_CHANNEL_RESPONSE_MESSAGES) {
    throw new RangeError(
      `Channel response cannot contain more than ${MAX_CHANNEL_RESPONSE_MESSAGES} messages`,
    );
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index];
    }
  }

  return undefined;
}

/** Builds channel response parts. */
export function buildChannelResponseParts(response: AgentResponse): ChannelResponsePart[] {
  if (response.toolCalls.length > MAX_CHANNEL_RESPONSE_TOOL_CALLS) {
    throw new RangeError(
      `Channel response cannot contain more than ${MAX_CHANNEL_RESPONSE_TOOL_CALLS} tool calls`,
    );
  }

  const responseParts: ChannelResponsePart[] = [];
  const knownToolCallIds = new Set<string>();
  let hasTextPart = false;

  if (response.thinking?.trim()) {
    responseParts.push(channelReasoningPartSchema.parse({
      type: "reasoning",
      text: response.thinking,
    }));
  }

  for (const toolCall of response.toolCalls) {
    if (knownToolCallIds.has(toolCall.id)) continue;
    knownToolCallIds.add(toolCall.id);
    responseParts.push(channelToolCallPartSchema.parse({
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.name,
      input: snapshotJsonRecord(toolCall.args, "Channel tool input"),
      state: toChannelToolCallState(toolCall.status),
    }));

    if (toolCall.status === "completed" || toolCall.status === "error") {
      responseParts.push(channelToolResultPartSchema.parse({
        type: "tool_result",
        tool_call_id: toolCall.id,
        output: toolCall.status === "error"
          ? { error: toolCall.error ?? "Tool execution failed" }
          : toolCall.result === undefined
          ? null
          : snapshotJsonValue(toolCall.result, "Channel tool result"),
        ...(toolCall.status === "error" ? { is_error: true } : {}),
      }));
    }
  }

  const lastAssistantMessage = findLastAssistantMessage(response.messages);
  if (lastAssistantMessage) {
    if (lastAssistantMessage.parts.length > MAX_CHANNEL_RESPONSE_MESSAGE_PARTS) {
      throw new RangeError(
        `Channel assistant response cannot contain more than ${MAX_CHANNEL_RESPONSE_MESSAGE_PARTS} parts`,
      );
    }
    for (const part of lastAssistantMessage.parts) {
      const converted = convertAssistantPartToChannelResponsePart(part, knownToolCallIds);
      if (converted) {
        responseParts.push(converted);
        if (converted.type === "text") hasTextPart = true;
        if (converted.type === "tool_call") knownToolCallIds.add(converted.id);
      }
    }
  }

  if (!hasTextPart && response.text.trim()) {
    responseParts.push(channelTextPartSchema.parse({
      type: "text",
      text: response.text,
    }));
  }

  return responseParts;
}

function classifyChannelInvokeError(error: unknown): ChannelInvokeResponse["error"] {
  const veryfrontError = fromError(error);

  if (veryfrontError?.type === "no_ai_available") {
    return { code: "provider_error", retryable: false };
  }

  if (veryfrontError?.type === "api" || veryfrontError?.type === "network") {
    return { code: "provider_error", retryable: true };
  }

  return { code: "internal_error", retryable: true };
}

function parseSerializableChannelInvokeResponse(value: unknown): ChannelInvokeResponse {
  const snapshot = snapshotJsonValue(value, "Channel invoke response");
  return ChannelInvokeResponseSchema.parse(snapshot);
}

function discoveredAgentLogFields(
  deps: Pick<ChannelInvokeDeps, "getAllAgentIds">,
): Record<string, unknown> {
  try {
    const ids = deps.getAllAgentIds();
    return {
      discoveredAgentCount: ids.length,
      discoveredAgentIds: ids.slice(0, MAX_DISCOVERED_AGENT_IDS_IN_LOG),
    };
  } catch (error) {
    return {
      discoveredAgentIds: "unavailable",
      discoveryError: error instanceof Error ? error.message : String(error),
    };
  }
}

function usesPersistentMemory(agent: Agent): boolean {
  return agent.config.memory !== undefined && agent.config.memory.enabled !== false;
}

class PersistentAgentInvocationQueueFullError extends Error {
  constructor() {
    super("Persistent channel agent invocation queue is full");
    this.name = "PersistentAgentInvocationQueueFullError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ??
    new DOMException("The channel invocation was aborted", "AbortError");
}

function waitForInvocation<T>(invocation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return invocation;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    invocation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function runWithPersistentAgentIsolation<T>(
  agent: Agent,
  operation: () => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  if (!usesPersistentMemory(agent)) {
    abortSignal?.throwIfAborted();
    return await operation();
  }

  let state = persistentAgentInvocations.get(agent);
  if (!state) {
    state = { pending: 0, tail: Promise.resolve() };
    persistentAgentInvocations.set(agent, state);
  }
  if (state.pending >= MAX_PERSISTENT_AGENT_INVOCATIONS) {
    throw new PersistentAgentInvocationQueueFullError();
  }

  state.pending += 1;
  const invocation = state.tail.then(async () => {
    abortSignal?.throwIfAborted();
    return await operation();
  });
  const settled = invocation.then(
    () => undefined,
    () => undefined,
  );
  state.tail = settled;
  void settled.then(() => {
    state.pending -= 1;
    if (state.pending === 0 && persistentAgentInvocations.get(agent) === state) {
      persistentAgentInvocations.delete(agent);
    }
  });

  return await waitForInvocation(invocation, abortSignal);
}

/** Optional execution controls for a channel invocation. */
export interface ExecuteChannelInvokeOptions {
  /** Cancels queued work and is forwarded to agent generation. */
  abortSignal?: AbortSignal;
}

/** Execute channel invoke. */
export async function executeChannelInvoke(
  payload: ChannelInvokeRequest,
  ctx: HandlerContext,
  deps: ChannelInvokeDeps,
  options: ExecuteChannelInvokeOptions = {},
): Promise<ChannelInvokeResponse> {
  try {
    options.abortSignal?.throwIfAborted();
    await deps.ensureProjectDiscovery(ctx);
    options.abortSignal?.throwIfAborted();

    const agent = resolveChannelInvokeAgent(payload.assistantId, deps);
    if (!agent) {
      logger.error("Channel invoke could not resolve a runtime agent for the request", {
        requestedAssistantId: payload.assistantId,
        ...discoveredAgentLogFields(deps),
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
      });
      return {
        ignored: false,
        error: {
          code: "internal_error",
          retryable: false,
        },
      };
    }

    return await runWithPersistentAgentIsolation(agent, async () => {
      const normalizedHistory = normalizeConversationHistoryForRuntime(
        payload.conversationHistory,
      );
      await agent.clearMemory();

      const result = await agent.generate({
        input: normalizedHistory,
        context: {
          requestId: payload.dispatchId,
          dispatchId: payload.dispatchId,
          conversationId: payload.conversationId,
          projectId: payload.projectId,
          assistantId: payload.assistantId,
          channel: payload.inboundMessage,
        },
        ...(payload.generation?.maxResponseTokens
          ? {
            maxOutputTokens: payload.generation.maxResponseTokens,
          }
          : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      });

      return parseSerializableChannelInvokeResponse({
        ignored: false,
        responseParts: buildChannelResponseParts(result),
        ...(result.usage
          ? {
            tokenUsage: {
              inputTokens: result.usage.promptTokens,
              outputTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
              ...(typeof result.usage.cachedInputTokens === "number"
                ? { cachedInputTokens: result.usage.cachedInputTokens }
                : {}),
              ...(typeof result.usage.cacheCreationInputTokens === "number"
                ? { cacheCreationInputTokens: result.usage.cacheCreationInputTokens }
                : {}),
              ...(typeof result.usage.cacheReadInputTokens === "number"
                ? { cacheReadInputTokens: result.usage.cacheReadInputTokens }
                : {}),
              ...(typeof result.usage.reasoningTokens === "number"
                ? { reasoningTokens: result.usage.reasoningTokens }
                : {}),
            },
          }
          : {}),
      });
    }, options.abortSignal);
  } catch (error) {
    if (error instanceof PersistentAgentInvocationQueueFullError) {
      logger.warn("Channel invoke persistent agent queue is saturated", {
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        dispatchId: payload.dispatchId,
      });
    } else if (!options.abortSignal?.aborted) {
      logger.error("Channel invoke runtime execution failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        dispatchId: payload.dispatchId,
      });
    }

    return {
      ignored: false,
      error: classifyChannelInvokeError(error),
    };
  }
}
