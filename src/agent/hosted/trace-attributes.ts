type TracePrimitive = string | number | boolean;
/** Public API contract for a value can be used as an agent trace attribute. */
export type AgentTraceAttributeValue =
  | TracePrimitive
  | readonly TracePrimitive[]
  | null
  | undefined;
/** Public API contract for agent trace attributes. */
export type AgentTraceAttributes = Record<string, AgentTraceAttributeValue>;

/** Public API contract for agent trace usage. */
export type AgentTraceUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

function compactTraceAttributes(attributes: AgentTraceAttributes): AgentTraceAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== null && value !== undefined),
  );
}

function isAgentTraceAttributePrimitive(value: unknown): value is TracePrimitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Check whether a value can be used as an agent trace attribute. */
export function isAgentTraceAttributeValue(value: unknown): value is AgentTraceAttributeValue {
  if (value === null || value === undefined || isAgentTraceAttributePrimitive(value)) {
    return true;
  }

  return Array.isArray(value) && value.every(isAgentTraceAttributePrimitive);
}

/** Filter agent trace attributes. */
export function filterAgentTraceAttributes(
  attributes: Record<string, unknown>,
): AgentTraceAttributes {
  const traceAttributes: AgentTraceAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (isAgentTraceAttributeValue(value)) {
      traceAttributes[key] = value;
    }
  }

  return traceAttributes;
}

function resolveGenAiProviderName(modelId: string | null | undefined): string | null {
  const normalizedModelId = modelId?.startsWith("veryfront-cloud/")
    ? modelId.slice("veryfront-cloud/".length)
    : modelId;
  const provider = normalizedModelId?.split("/")[0]?.trim().toLowerCase();

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
      return null;
  }
}

function buildUsageTraceAttributes(usage?: AgentTraceUsage): AgentTraceAttributes {
  return compactTraceAttributes({
    ...(typeof usage?.inputTokens === "number"
      ? { "gen_ai.usage.input_tokens": usage.inputTokens }
      : {}),
    ...(typeof usage?.outputTokens === "number"
      ? { "gen_ai.usage.output_tokens": usage.outputTokens }
      : {}),
    ...(typeof usage?.cachedInputTokens === "number"
      ? { "gen_ai.usage.cache_read.input_tokens": usage.cachedInputTokens }
      : {}),
  });
}

/** Builds agent run trace attributes. */
export function buildAgentRunTraceAttributes(input: {
  operationName: "chat" | "invoke_agent";
  conversationId?: string;
  projectId?: string | null;
  userId: string;
  agentId: string;
  runId?: string | null;
  parentRunId?: string | null;
  parentConversationId?: string | null;
  messageId?: string | null;
  toolCallId?: string | null;
}): AgentTraceAttributes {
  return compactTraceAttributes({
    "conversation.id": input.conversationId,
    "project.id": input.projectId,
    "user.id": input.userId,
    "agent.id": input.agentId,
    "run.id": input.runId,
    "parent.run.id": input.parentRunId,
    "parent.conversation.id": input.parentConversationId,
    "message.id": input.messageId,
    "tool.call.id": input.toolCallId,
    "gen_ai.operation.name": input.operationName,
    "gen_ai.conversation.id": input.conversationId,
    "gen_ai.agent.id": input.agentId,
  });
}

/** Builds execute tool trace attributes. */
export function buildExecuteToolTraceAttributes(input: {
  toolName: string;
  toolCallId?: string | null;
}): AgentTraceAttributes {
  return compactTraceAttributes({
    "tool.name": input.toolName,
    "tool.call.id": input.toolCallId,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": input.toolName,
    "gen_ai.tool.type": "function",
    "gen_ai.tool.call.id": input.toolCallId,
  });
}

/** Builds invoke agent trace attributes. */
export function buildInvokeAgentTraceAttributes(input: {
  conversationId?: string;
  projectId?: string | null;
  runId?: string | null;
  toolCallId: string;
  childAgentId: string;
  childConversationId?: string | null;
  childRunId?: string | null;
  childMessageId?: string | null;
  sourceTargetKind?: string | null;
  runtimeTargetKind?: string | null;
  targetEnvironmentId?: string | null;
  targetBranchId?: string | null;
  status?: "completed" | "failed";
  usage?: AgentTraceUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}): AgentTraceAttributes {
  return compactTraceAttributes({
    "conversation.id": input.conversationId,
    "project.id": input.projectId,
    "run.id": input.runId,
    "child.agent.id": input.childAgentId,
    "child.conversation.id": input.childConversationId,
    "child.run.id": input.childRunId,
    "child.message.id": input.childMessageId,
    "source.target.kind": input.sourceTargetKind,
    "runtime.target.kind": input.runtimeTargetKind,
    "target.environment.id": input.targetEnvironmentId,
    "target.branch.id": input.targetBranchId,
    ...(input.status ? { "agent.run.final_status": input.status } : {}),
    ...(input.status === "failed"
      ? {
        "error.type": input.terminalErrorCode ?? "INVOKE_AGENT_FAILED",
        "error.message": input.terminalErrorMessage,
      }
      : {}),
    ...buildExecuteToolTraceAttributes({
      toolName: "invoke_agent",
      toolCallId: input.toolCallId,
    }),
    ...buildUsageTraceAttributes(input.usage),
  });
}

/** Builds finalized agent run trace attributes. */
export function buildFinalizedAgentRunTraceAttributes(input: {
  status: "completed" | "failed" | "cancelled";
  modelId?: string | null;
  usage?: AgentTraceUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}): AgentTraceAttributes {
  const providerName = resolveGenAiProviderName(input.modelId);
  const finishReason = input.status === "cancelled"
    ? "cancelled"
    : input.status === "completed"
    ? "stop"
    : null;

  return compactTraceAttributes({
    "agent.run.final_status": input.status,
    ...(providerName ? { "gen_ai.provider.name": providerName } : {}),
    ...(input.modelId ? { "gen_ai.response.model": input.modelId } : {}),
    ...(finishReason ? { "gen_ai.response.finish_reasons": [finishReason] } : {}),
    ...(input.status === "failed"
      ? {
        "error.type": input.terminalErrorCode ?? "STREAM_ERROR",
        "error.message": input.terminalErrorMessage,
      }
      : {}),
    ...buildUsageTraceAttributes(input.usage),
  });
}
