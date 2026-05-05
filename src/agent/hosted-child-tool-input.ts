import { z } from "zod";
import { withDefaultResearchArtifactPath } from "./default-research-artifact-policy.ts";
import type { RuntimeAgentThinkingConfig } from "./runtime-agent-definition.ts";

export const DEFAULT_HOSTED_CHILD_AGENT_ID = "invoke-agent-child";

export const hostedChildForkToolInputSchema = z.object({
  description: z.string().describe("3-5 word task summary"),
  prompt: z.string().describe("Detailed instructions for the task"),
  project_id: z.string().optional().describe(
    "Override project context. Use after studio_open_project.",
  ),
  tools: z.array(z.string()).optional().describe(
    "Tool subset for this fork. Omit = inherit all parent tools.",
  ),
  model: z.string().optional().describe('Model override (e.g. "sonnet" for cheaper work).'),
  thinking: z
    .number()
    .nonnegative()
    .optional()
    .describe("Thinking override in budget tokens. Use 0 to disable thinking."),
  max_steps: z.number().optional().describe("Max steps override."),
});

export type HostedChildForkToolInput = z.infer<typeof hostedChildForkToolInputSchema>;

export type HostedChildForkRuntimeConfig = {
  description: string;
  effectivePrompt: string;
  requestedTools: string[] | undefined;
  forkModel: string;
  provider: string;
  maxSteps: number;
  thinkingConfig: RuntimeAgentThinkingConfig | undefined;
};

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
