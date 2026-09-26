import { buildRuntimeUsageTraceAttributes } from "../runtime/trace-usage.ts";

type TracePrimitive = string | number | boolean;
type EnvReader = (name: string) => string | undefined;
/** Public API contract for a value can be used as an agent trace attribute. */
export type AgentTraceAttributeValue =
  | TracePrimitive
  | readonly TracePrimitive[]
  | null
  | undefined;
/** Public API contract for agent trace attributes. */
export type AgentTraceAttributes = Record<string, AgentTraceAttributeValue>;

/**
 * Public API contract for agent trace usage.
 *
 * Carries the billing fields as well as the token counts. The hosted path's run span
 * (named `invoke_agent <agentName>`, not `agent.run`) was reporting tokens and no
 * spend at all, so hosted runs carried no queryable cost on any status.
 */
export type AgentTraceUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: "direct" | "deferred";
  usageCaptureStatus?: "complete" | "partial" | "missing";
};

function compactTraceAttributes(attributes: AgentTraceAttributes): AgentTraceAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== null && value !== undefined),
  );
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseResourceAttributes(value: string | undefined): Record<string, string> {
  if (!value) return {};

  const attributes: Record<string, string> = {};
  for (const part of value.split(",")) {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey?.trim();
    if (!key || rawValueParts.length === 0) continue;
    const attributeValue = rawValueParts.join("=").trim();
    if (attributeValue) attributes[key] = attributeValue;
  }
  return attributes;
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

/** Builds schedule trigger trace attributes from schedule forwarded props. */
export function buildScheduleTraceAttributes(
  forwardedProps?: Record<string, unknown>,
): AgentTraceAttributes {
  const scheduleId = getNonEmptyString(forwardedProps?.schedule_id) ??
    getNonEmptyString(forwardedProps?.scheduleId);
  const scheduleName = getNonEmptyString(forwardedProps?.schedule_name) ??
    getNonEmptyString(forwardedProps?.scheduleName);

  return compactTraceAttributes({
    "schedule.id": scheduleId,
    "schedule.name": scheduleName,
    "run.trigger.kind": scheduleId ? "schedule" : undefined,
    "run.trigger.id": scheduleId,
  });
}

/** Builds Datadog unified service trace attributes for a hosted project run. */
export function buildProjectServiceTraceAttributes(input: {
  projectSlug?: string | null;
  readEnv: EnvReader;
}): AgentTraceAttributes {
  const resourceAttributes = parseResourceAttributes(input.readEnv("OTEL_RESOURCE_ATTRIBUTES"));
  const projectSlug = getNonEmptyString(input.projectSlug);
  const serviceName = getNonEmptyString(input.readEnv("OTEL_SERVICE_NAME")) ??
    getNonEmptyString(resourceAttributes["service.name"]) ??
    getNonEmptyString(input.readEnv("DD_SERVICE")) ??
    projectSlug ??
    "veryfront-agent-service";
  const serviceVersion = getNonEmptyString(resourceAttributes["service.version"]) ??
    getNonEmptyString(input.readEnv("OTEL_SERVICE_VERSION")) ??
    getNonEmptyString(input.readEnv("DD_VERSION")) ??
    getNonEmptyString(input.readEnv("VERYFRONT_VERSION")) ??
    getNonEmptyString(input.readEnv("RELEASE_VERSION"));
  const deploymentEnvironment = getNonEmptyString(
    resourceAttributes["deployment.environment.name"],
  ) ??
    getNonEmptyString(resourceAttributes["deployment.environment"]) ??
    getNonEmptyString(input.readEnv("OTEL_DEPLOYMENT_ENVIRONMENT")) ??
    getNonEmptyString(input.readEnv("DD_ENV")) ??
    getNonEmptyString(input.readEnv("APP_ENVIRONMENT")) ??
    getNonEmptyString(input.readEnv("VERYFRONT_ENVIRONMENT"));

  return compactTraceAttributes({
    "project.slug": projectSlug,
    "service.name": serviceName,
    "service": serviceName,
    "service.version": serviceVersion,
    "version": serviceVersion,
    "deployment.environment.name": deploymentEnvironment,
    "deployment.environment": deploymentEnvironment,
    "env": deploymentEnvironment,
  });
}

export function resolveGenAiProviderName(modelId: string | null | undefined): string | null {
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

/**
 * Both agent run span emitters share one attribute builder.
 *
 * The internal-agent path (src/internal-agents/run-stream.ts, span `agent.run`)
 * already used {@link buildRuntimeUsageTraceAttributes}; the hosted path (span
 * `invoke_agent <agentName>`) had a parallel token-only copy, so two spans describing
 * the same kind of work carried different attribute sets. Delegating keeps token
 * naming identical and gives hosted runs the `agent.usage.*` billing attributes.
 *
 * Note for anyone building a spend roll-up on these attributes: the hosted emitter
 * also spans delegated sub-agent runs, so summing `agent.usage.cost_credits` across
 * `invoke_agent` spans without filtering will count a parent and its children.
 */
function buildUsageTraceAttributes(usage?: AgentTraceUsage): AgentTraceAttributes {
  return compactTraceAttributes(buildRuntimeUsageTraceAttributes(usage));
}

/** Builds agent run trace attributes. */
export function buildAgentRunTraceAttributes(input: {
  operationName: "chat" | "invoke_agent";
  conversationId?: string;
  projectId?: string | null;
  userId: string;
  agentId: string;
  agentName?: string | null;
  modelId?: string | null;
  runId?: string | null;
  parentRunId?: string | null;
  parentConversationId?: string | null;
  messageId?: string | null;
  toolCallId?: string | null;
  scheduleId?: string | null;
  scheduleName?: string | null;
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
    "schedule.id": input.scheduleId,
    "schedule.name": input.scheduleName,
    "run.trigger.kind": input.scheduleId ? "schedule" : undefined,
    "run.trigger.id": input.scheduleId,
    "gen_ai.operation.name": input.operationName,
    "gen_ai.conversation.id": input.conversationId,
    "gen_ai.agent.id": input.agentId,
    "gen_ai.agent.name": input.agentName,
    "gen_ai.request.model": input.modelId,
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

/** Stable `error.type` of a failed agent run, also used as its span status message. */
export function resolveAgentRunErrorType(terminalErrorCode?: string | null): string {
  return terminalErrorCode ?? "STREAM_ERROR";
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
        "error.type": resolveAgentRunErrorType(input.terminalErrorCode),
        "error.message": input.terminalErrorMessage,
      }
      : {}),
    ...buildUsageTraceAttributes(input.usage),
  });
}
