import { defineSchema, getJsonValueSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { withDefaultResearchArtifactPath } from "../artifacts/default-research-artifact-policy.ts";
import type { ChildRunResultMode } from "../child-run/result-summary.ts";
import type { RuntimeAgentThinkingConfig } from "../runtime/agent-definition.ts";

/** Default value for hosted child agent ID. */
export const DEFAULT_HOSTED_CHILD_AGENT_ID = "invoke-agent-child";
export const MAX_HOSTED_CHILD_DELEGATION_DEPTH = 8;
const HOSTED_CHILD_FORK_RESULT_MODES = ["summary", "full", "structured"] as const;

/** Hosted child fork result return mode. */
export type HostedChildForkResultMode = ChildRunResultMode;

export const getHostedChildForkToolInputSchema = defineSchema((v) =>
  v.object({
    description: v.string().describe("3-5 word task summary"),
    prompt: v.string().describe("Detailed instructions for the task"),
    context: v.record(v.string(), getJsonValueSchema()).default({}).describe(
      "Structured data payload for the child task. Use this for critical facts, records, ids, decisions, and values the child must act on. Defaults to {} when the delegation has no record or evidence payload.",
    ),
    project_id: v.string().optional().describe(
      "Override project context. Use after studio_open_project.",
    ),
    tools: v.array(v.string()).optional().describe(
      "Tool subset for this fork. Omit = inherit all parent tools.",
    ),
    model: v.string().optional().describe('Model override (e.g. "sonnet" for cheaper work).'),
    temperature: v.number().min(0).max(2).optional().describe(
      "Sampling temperature override. Omit for the hosted child default.",
    ),
    thinking: v
      .number()
      .nonnegative()
      .optional()
      .describe("Thinking override in budget tokens. Use 0 to disable thinking."),
    max_steps: v.number().optional().describe(
      "Max steps override. Omit for the hosted child default. Values below the default are raised to the default.",
    ),
    result_mode: v.enum(HOSTED_CHILD_FORK_RESULT_MODES).optional().describe(
      'Result return mode. Omit or use "summary" for the bounded default. Use "full" only when exact delegated output is required. Use "structured" when critical contract ids must survive a bounded summary.',
    ),
  })
);

/** Schema for hosted child fork tool input.
 * @deprecated Use getHostedChildForkToolInputSchema()
 */
export const hostedChildForkToolInputSchema = lazySchema(getHostedChildForkToolInputSchema);

/** Input payload for hosted child fork tool. */
type ParsedHostedChildForkToolInput = InferSchema<
  ReturnType<typeof getHostedChildForkToolInputSchema>
>;
export type HostedChildForkToolInput =
  & Omit<ParsedHostedChildForkToolInput, "context">
  & {
    context?: ParsedHostedChildForkToolInput["context"];
  };

/** Configuration used by hosted child fork runtime. */
export type HostedChildForkRuntimeConfig = {
  description: string;
  effectivePrompt: string;
  requestedTools: string[] | undefined;
  forkModel: string;
  provider: string;
  temperature?: number;
  maxSteps: number;
  thinkingConfig: RuntimeAgentThinkingConfig | undefined;
};

export type HostedChildInvocationContext = {
  root_conversation_id?: string;
  root_run_id?: string;
  root_message_id?: string;
  parent_conversation_id?: string;
  parent_run_id?: string;
  parent_message_id?: string;
  tool_call_id?: string;
  delegation_depth: number;
};

function getTrustedInvocationContext(
  value: HostedChildInvocationContext | undefined,
): HostedChildInvocationContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const depth = Number.isInteger(value.delegation_depth) ? Math.max(0, value.delegation_depth) : 0;

  return {
    ...(typeof value.root_conversation_id === "string"
      ? { root_conversation_id: value.root_conversation_id }
      : {}),
    ...(typeof value.root_run_id === "string" ? { root_run_id: value.root_run_id } : {}),
    ...(typeof value.root_message_id === "string"
      ? { root_message_id: value.root_message_id }
      : {}),
    ...(typeof value.parent_conversation_id === "string"
      ? { parent_conversation_id: value.parent_conversation_id }
      : {}),
    ...(typeof value.parent_run_id === "string" ? { parent_run_id: value.parent_run_id } : {}),
    ...(typeof value.parent_message_id === "string"
      ? { parent_message_id: value.parent_message_id }
      : {}),
    ...(typeof value.tool_call_id === "string" ? { tool_call_id: value.tool_call_id } : {}),
    delegation_depth: depth,
  };
}

function assertCanDelegate(parentDepth: number): void {
  if (parentDepth >= MAX_HOSTED_CHILD_DELEGATION_DEPTH) {
    throw new Error(
      `invoke_agent delegation depth limit exceeded: maximum depth is ${MAX_HOSTED_CHILD_DELEGATION_DEPTH}.`,
    );
  }
}

function buildHostedChildInvocationContext(
  input: {
    parentConversationId?: string;
    conversationId?: string;
    parentRunId?: string;
    parentMessageId?: string;
    toolCallId: string;
    trustedInvocationContext?: HostedChildInvocationContext;
  },
): HostedChildInvocationContext {
  const trusted = getTrustedInvocationContext(input.trustedInvocationContext);
  const parentDepth = trusted?.delegation_depth ?? 0;
  assertCanDelegate(parentDepth);

  const parentConversationId = input.parentConversationId ?? input.conversationId;
  const rootConversationId = trusted?.root_conversation_id || parentConversationId;
  const rootRunId = trusted?.root_run_id || input.parentRunId;
  const rootMessageId = trusted?.root_message_id || input.parentMessageId;

  return {
    ...(rootConversationId
      ? {
        root_conversation_id: rootConversationId,
      }
      : {}),
    ...(parentConversationId
      ? {
        parent_conversation_id: parentConversationId,
      }
      : {}),
    ...(rootRunId
      ? {
        root_run_id: rootRunId,
      }
      : {}),
    ...(rootMessageId
      ? {
        root_message_id: rootMessageId,
      }
      : {}),
    ...(input.parentRunId
      ? {
        parent_run_id: input.parentRunId,
      }
      : {}),
    ...(input.parentMessageId
      ? {
        parent_message_id: input.parentMessageId,
      }
      : {}),
    tool_call_id: input.toolCallId,
    delegation_depth: parentDepth + 1,
  };
}

/** Adds Veryfront invocation metadata to hosted child fork input. */
export function withHostedChildInvocationContext(
  forkInput: HostedChildForkToolInput,
  input: {
    parentConversationId?: string;
    conversationId?: string;
    parentRunId?: string;
    parentMessageId?: string;
    toolCallId: string;
    trustedInvocationContext?: HostedChildInvocationContext;
  },
): HostedChildForkToolInput {
  return {
    ...forkInput,
    context: {
      ...(forkInput.context ?? {}),
      veryfront_invocation_context: buildHostedChildInvocationContext({
        ...input,
      }),
    },
  };
}

/** Input payload for resolve hosted child fork runtime config. */
export type ResolveHostedChildForkRuntimeConfigInput = {
  forkInput: Pick<
    HostedChildForkToolInput,
    | "description"
    | "prompt"
    | "context"
    | "tools"
    | "model"
    | "temperature"
    | "thinking"
    | "max_steps"
  >;
  contextModel?: string;
  defaultModel: string;
  defaultMaxSteps: number;
  runId: string;
  resolveModelId: (modelId: string) => string;
  resolveProvider: (modelId: string) => string;
  resolveModelThinking?: (modelId: string) => RuntimeAgentThinkingConfig | undefined;
};

/** Resolves hosted child fork thinking override. */
export function resolveHostedChildForkThinkingOverride(
  thinking: HostedChildForkToolInput["thinking"],
): RuntimeAgentThinkingConfig | undefined {
  if (thinking === 0) {
    return { enabled: false };
  }

  if (typeof thinking === "number") {
    return { enabled: true, budgetTokens: thinking };
  }

  return undefined;
}

function appendStructuredContextToPrompt(
  prompt: string,
  context: HostedChildForkToolInput["context"],
): string {
  return `${prompt}\n\n<structured_context>\n${
    JSON.stringify(context)
  }\n</structured_context>\nTreat structured_context as the authoritative data payload for the child task. If prose conflicts with structured_context, use structured_context and say what conflicted.`;
}

/** Builds the effective hosted child fork prompt. */
export function buildHostedChildForkEffectivePrompt(input: {
  description: string;
  prompt: string;
  context: HostedChildForkToolInput["context"];
  runId: string;
}): string {
  const promptWithArtifactPath = withDefaultResearchArtifactPath({
    description: input.description,
    prompt: input.prompt,
    runId: input.runId,
  });

  return appendStructuredContextToPrompt(promptWithArtifactPath, input.context);
}

/** Configuration used by resolve hosted child fork runtime. */
export function resolveHostedChildForkRuntimeConfig(
  input: ResolveHostedChildForkRuntimeConfigInput,
): HostedChildForkRuntimeConfig {
  const { description, prompt, tools, model, temperature, thinking, max_steps } = input.forkInput;
  const context = input.forkInput.context ?? {};
  const forkModel = input.resolveModelId(model || input.contextModel || input.defaultModel);
  const requestedMaxSteps = typeof max_steps === "number" ? max_steps : undefined;
  const thinkingConfig = resolveHostedChildForkThinkingOverride(thinking) ??
    input.resolveModelThinking?.(forkModel);

  return {
    description,
    effectivePrompt: buildHostedChildForkEffectivePrompt({
      description,
      prompt,
      context,
      runId: input.runId,
    }),
    requestedTools: tools,
    forkModel,
    provider: input.resolveProvider(forkModel),
    ...(temperature === undefined ? {} : { temperature }),
    maxSteps: Math.max(requestedMaxSteps ?? input.defaultMaxSteps, input.defaultMaxSteps),
    thinkingConfig,
  };
}
