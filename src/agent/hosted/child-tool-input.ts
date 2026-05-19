import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { withDefaultResearchArtifactPath } from "../artifacts/default-research-artifact-policy.ts";
import type { RuntimeAgentThinkingConfig } from "../runtime/agent-definition.ts";

/** Default value for hosted child agent ID. */
export const DEFAULT_HOSTED_CHILD_AGENT_ID = "invoke-agent-child";

export const getHostedChildForkToolInputSchema = defineSchema((v) =>
  v.object({
    description: v.string().describe("3-5 word task summary"),
    prompt: v.string().describe("Detailed instructions for the task"),
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
    max_steps: v.number().optional().describe("Max steps override."),
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

/** Input payload for resolve hosted child fork runtime config. */
export type ResolveHostedChildForkRuntimeConfigInput = {
  forkInput: Pick<
    HostedChildForkToolInput,
    "description" | "prompt" | "tools" | "model" | "thinking" | "max_steps"
  >;
  contextModel?: string;
  defaultModel: string;
  defaultMaxSteps: number;
  runId: string;
  resolveModelId: (modelId: string) => string;
  resolveProvider: (modelId: string) => string;
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

/** Configuration used by resolve hosted child fork runtime. */
export function resolveHostedChildForkRuntimeConfig(
  input: ResolveHostedChildForkRuntimeConfigInput,
): HostedChildForkRuntimeConfig {
  const { description, prompt, tools, model, thinking, max_steps } = input.forkInput;
  const forkModel = input.resolveModelId(model || input.contextModel || input.defaultModel);

  return {
    description,
    effectivePrompt: withDefaultResearchArtifactPath({
      description,
      prompt,
      runId: input.runId,
    }),
    requestedTools: tools,
    forkModel,
    provider: input.resolveProvider(forkModel),
    maxSteps: max_steps || input.defaultMaxSteps,
    thinkingConfig: resolveHostedChildForkThinkingOverride(thinking),
  };
}
