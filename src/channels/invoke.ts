import type { Agent, AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import type { HandlerContext } from "#veryfront/types";
import { serverLogger } from "#veryfront/utils";
import { z } from "zod";
import {
  getAgent as getRegisteredAgent,
  getAllAgentIds as getRegisteredAgentIds,
} from "../agent/composition/composition.ts";
import { listRuntimeAgents, type RuntimeAgentDiscoveryDeps } from "./control-plane.ts";
import { ensureProjectDiscovery as ensureProjectDiscoveryForProject } from "../server/handlers/request/api/project-discovery.ts";

const logger = serverLogger.component("channels-invoke");

const rawHistoryPartSchema = z.object({
  type: z.string(),
}).passthrough();

const channelAttachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "file"]),
  filename: z.string().optional(),
  mediaType: z.string().optional(),
  privateUrl: z.string().optional(),
});

const channelInvokeHistoryMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(rawHistoryPartSchema),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().optional(),
});

const channelInvokeRequestWireSchema = z.object({
  dispatchId: z.string().min(1),
  conversationId: z.string().min(1),
  projectId: z.string().min(1),
  assistantId: z.string().min(1),
  platform: z.literal("slack"),
  inboundMessage: z.object({
    text: z.string(),
    userId: z.string(),
    userName: z.string(),
    isDirectMessage: z.boolean(),
    attachments: z.array(channelAttachmentSchema).optional(),
  }),
  conversationHistory: z.array(channelInvokeHistoryMessageSchema),
  generation: z.object({
    maxResponseTokens: z.number().int().positive().max(16384).optional(),
  }).optional(),
});

export const ChannelInvokeRequestSchema = channelInvokeRequestWireSchema;

export const ChannelAssistantsRequestSchema = z.object({
  requestId: z.string().min(1),
  projectId: z.string().min(1),
  platform: z.literal("slack"),
});

export const ChannelAssistantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});

export const ChannelAssistantsResponseSchema = z.object({
  assistants: z.array(ChannelAssistantSchema),
});

const channelTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const channelToolCallPartSchema = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
  state: z.enum(["streaming", "pending", "completed", "error"]),
});

const channelToolResultPartSchema = z.object({
  type: z.literal("tool_result"),
  tool_call_id: z.string(),
  output: z.unknown(),
  is_error: z.boolean().optional(),
});

const channelReasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});

const channelErrorPartSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export const ChannelResponsePartSchema = z.discriminatedUnion("type", [
  channelTextPartSchema,
  channelToolCallPartSchema,
  channelToolResultPartSchema,
  channelReasoningPartSchema,
  channelErrorPartSchema,
]);

export const ChannelInvokeResponseSchema = z.object({
  ignored: z.boolean(),
  responseParts: z.array(ChannelResponsePartSchema).optional(),
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  }).optional(),
  error: z.object({
    code: z.enum(["provider_error", "internal_error"]),
    retryable: z.boolean(),
  }).optional(),
});

export type ChannelInvokeRequest = z.infer<typeof ChannelInvokeRequestSchema>;
export type ChannelInvokeResponse = z.infer<typeof ChannelInvokeResponseSchema>;
export type ChannelAssistantsRequest = z.infer<typeof ChannelAssistantsRequestSchema>;
export type ChannelAssistantsResponse = z.infer<typeof ChannelAssistantsResponseSchema>;

type ChannelResponsePart = z.infer<typeof ChannelResponsePartSchema>;
export interface ChannelInvokeDeps extends RuntimeAgentDiscoveryDeps {}

export const defaultChannelInvokeDeps: ChannelInvokeDeps = {
  ensureProjectDiscovery: ensureProjectDiscoveryForProject,
  getAgent: getRegisteredAgent,
  getAllAgentIds: getRegisteredAgentIds,
};

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
export { verifyDispatchJws } from "./control-plane.ts";

function normalizeConversationPart(
  part: z.infer<typeof rawHistoryPartSchema>,
): Message["parts"][number] | null {
  if (part.type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }

  if (
    part.type === "tool_call" &&
    typeof part.id === "string" &&
    typeof part.name === "string" &&
    part.input &&
    typeof part.input === "object" &&
    !Array.isArray(part.input)
  ) {
    return {
      type: `tool-${part.name}`,
      toolCallId: part.id,
      toolName: part.name,
      args: part.input as Record<string, unknown>,
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

  return null;
}

export function normalizeConversationHistoryForRuntime(
  messages: ChannelInvokeRequest["conversationHistory"],
): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts
      .map((part) => normalizeConversationPart(part))
      .filter((part): part is NonNullable<typeof part> => part !== null),
    ...(message.createdAt ? { timestamp: Date.parse(message.createdAt) || undefined } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  }));
}

export function resolveChannelInvokeAgent(
  assistantId: string,
  deps: Pick<ChannelInvokeDeps, "getAgent" | "getAllAgentIds">,
): Agent | undefined {
  return deps.getAgent(assistantId);
}

function normalizeToolCallState(status: string): "pending" | "completed" | "error" {
  switch (status) {
    case "completed":
      return "completed";
    case "error":
      return "error";
    default:
      return "pending";
  }
}

function convertAssistantPartToChannelResponsePart(
  part: Message["parts"][number],
  knownToolCallIds: Set<string>,
): ChannelResponsePart | null {
  if (part.type === "text" && "text" in part) {
    return channelTextPartSchema.parse({
      type: "text",
      text: part.text,
    });
  }

  const isToolCallPart = part.type === "tool-call" ||
    (part.type.startsWith("tool-") && part.type !== "tool-result");
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
      input: "args" in part ? part.args : ("input" in part ? part.input : {}),
      state: "pending",
    });
  }

  return null;
}

function findLastAssistantMessage(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index];
    }
  }

  return undefined;
}

export function buildChannelResponseParts(response: AgentResponse): ChannelResponsePart[] {
  const responseParts: ChannelResponsePart[] = [];
  const knownToolCallIds = new Set<string>();

  if (response.thinking?.trim()) {
    responseParts.push(channelReasoningPartSchema.parse({
      type: "reasoning",
      text: response.thinking,
    }));
  }

  for (const toolCall of response.toolCalls) {
    knownToolCallIds.add(toolCall.id);
    responseParts.push(channelToolCallPartSchema.parse({
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.args,
      state: normalizeToolCallState(toolCall.status),
    }));

    if (toolCall.status === "completed" || toolCall.status === "error") {
      responseParts.push(channelToolResultPartSchema.parse({
        type: "tool_result",
        tool_call_id: toolCall.id,
        output: toolCall.status === "error"
          ? { error: toolCall.error ?? "Tool execution failed" }
          : toolCall.result,
        ...(toolCall.status === "error" ? { is_error: true } : {}),
      }));
    }
  }

  const lastAssistantMessage = findLastAssistantMessage(response.messages);
  if (lastAssistantMessage) {
    for (const part of lastAssistantMessage.parts) {
      const converted = convertAssistantPartToChannelResponsePart(part, knownToolCallIds);
      if (converted) {
        responseParts.push(converted);
      }
    }
  } else if (response.text.trim()) {
    responseParts.push(channelTextPartSchema.parse({
      type: "text",
      text: response.text,
    }));
  }

  return responseParts;
}

function classifyRuntimeError(error: unknown): ChannelInvokeResponse["error"] {
  const veryfrontError = fromError(error);

  if (veryfrontError?.type === "no_ai_available") {
    return { code: "provider_error", retryable: false };
  }

  if (veryfrontError?.type === "api" || veryfrontError?.type === "network") {
    return { code: "provider_error", retryable: true };
  }

  return { code: "internal_error", retryable: true };
}

export async function executeChannelInvoke(
  payload: ChannelInvokeRequest,
  ctx: HandlerContext,
  deps: ChannelInvokeDeps,
): Promise<ChannelInvokeResponse> {
  await deps.ensureProjectDiscovery(ctx);

  const agent = resolveChannelInvokeAgent(payload.assistantId, deps);
  if (!agent) {
    logger.error("Channel invoke could not resolve a runtime agent for the request", {
      requestedAssistantId: payload.assistantId,
      discoveredAgentIds: deps.getAllAgentIds(),
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

  const messages = normalizeConversationHistoryForRuntime(payload.conversationHistory);
  await agent.clearMemory();

  try {
    const result = await agent.generate({
      input: messages,
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
    });

    return ChannelInvokeResponseSchema.parse({
      ignored: false,
      responseParts: buildChannelResponseParts(result),
      tokenUsage: result.usage
        ? {
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        }
        : undefined,
    });
  } catch (error) {
    logger.error("Channel invoke runtime execution failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      projectSlug: ctx.projectSlug,
      projectId: ctx.projectId,
      dispatchId: payload.dispatchId,
    });

    return {
      ignored: false,
      error: classifyRuntimeError(error),
    };
  }
}
