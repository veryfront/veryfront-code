import { defineSchema, getJsonValueSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { withDefaultResearchArtifactPath } from "../artifacts/default-research-artifact-policy.ts";
import type { ChildRunResultMode } from "../child-run/result-summary.ts";
import type { RuntimeAgentThinkingConfig } from "../runtime/agent-definition.ts";

/** Default value for hosted child agent ID. */
export const DEFAULT_HOSTED_CHILD_AGENT_ID = "invoke-agent-child";
const HOSTED_CHILD_FORK_RESULT_MODES = ["summary", "full"] as const;

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
    thinking: v
      .number()
      .nonnegative()
      .optional()
      .describe("Thinking override in budget tokens. Use 0 to disable thinking."),
    max_steps: v.number().optional().describe(
      "Max steps override. Omit for the hosted child default. Values below the default are raised to the default.",
    ),
    result_mode: v.enum(HOSTED_CHILD_FORK_RESULT_MODES).optional().describe(
      'Result return mode. Omit or use "summary" for the bounded default. Use "full" only when exact delegated output is required.',
    ),
  })
);

/** Schema for hosted child fork tool input.
 * @deprecated Use getHostedChildForkToolInputSchema()
 */
export const hostedChildForkToolInputSchema = lazySchema(getHostedChildForkToolInputSchema);

/** Input payload for hosted child fork tool. */
export type HostedChildForkToolInput = InferSchema<
  ReturnType<typeof getHostedChildForkToolInputSchema>
>;

/** Configuration used by hosted child fork runtime. */
export type HostedChildForkRuntimeConfig = {
  description: string;
  effectivePrompt: string;
  requestedTools: string[] | undefined;
  forkModel: string;
  provider: string;
  maxSteps: number;
  thinkingConfig: RuntimeAgentThinkingConfig | undefined;
};

function getStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};
  for (const [key, property] of Object.entries(value)) {
    if (typeof property === "string") {
      record[key] = property;
    }
  }

  return record;
}

function buildHostedChildInvocationContext(
  forkInput: HostedChildForkToolInput,
  input: {
    conversationId?: string;
    parentRunId?: string;
    toolCallId: string;
  },
): Record<string, string> {
  const existing = getStringRecord(forkInput.context?.veryfront_invocation_context);
  const rootConversationId = existing.root_conversation_id || input.conversationId;
  const rootRunId = existing.root_run_id || input.parentRunId;

  return {
    ...existing,
    ...(rootConversationId
      ? {
        root_conversation_id: rootConversationId,
      }
      : {}),
    ...(input.conversationId
      ? {
        parent_conversation_id: input.conversationId,
      }
      : {}),
    ...(rootRunId
      ? {
        root_run_id: rootRunId,
      }
      : {}),
    ...(input.parentRunId
      ? {
        parent_run_id: input.parentRunId,
      }
      : {}),
    tool_call_id: input.toolCallId,
  };
}

/** Adds Veryfront invocation metadata to hosted child fork input. */
export function withHostedChildInvocationContext(
  forkInput: HostedChildForkToolInput,
  input: {
    conversationId?: string;
    parentRunId?: string;
    toolCallId: string;
  },
): HostedChildForkToolInput {
  return {
    ...forkInput,
    context: {
      ...(forkInput.context ?? {}),
      veryfront_invocation_context: buildHostedChildInvocationContext(forkInput, input),
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
  const { description, prompt, context, tools, model, thinking, max_steps } = input.forkInput;
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
    maxSteps: Math.max(requestedMaxSteps ?? input.defaultMaxSteps, input.defaultMaxSteps),
    thinkingConfig,
  };
}
