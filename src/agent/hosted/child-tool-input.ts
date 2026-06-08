import { defineSchema, getJsonValueSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { withDefaultResearchArtifactPath } from "../artifacts/default-research-artifact-policy.ts";
import type { RuntimeAgentThinkingConfig } from "../runtime/agent-definition.ts";

/** Default value for hosted child agent ID. */
export const DEFAULT_HOSTED_CHILD_AGENT_ID = "invoke-agent-child";

const getHostedChildForkEvidenceRefSchema = defineSchema((v) =>
  v.object({
    id: v.string().optional().describe("Optional stable evidence reference id."),
    run_id: v.string().optional().describe("Run id that produced the evidence."),
    message_id: v.string().optional().describe("Message id that stores the evidence."),
    tool_call_id: v.string().optional().describe("Tool call id that produced the evidence."),
    result_path: v.string().optional().describe("JSONPath-style path into the structured result."),
    label: v.string().optional().describe("Short human-readable label for this evidence."),
    summary: v.string().optional().describe("Optional compact summary of the referenced evidence."),
  })
);

export const getHostedChildForkToolInputSchema = defineSchema((v) =>
  v.object({
    description: v.string().describe("3-5 word task summary"),
    prompt: v.string().describe("Detailed instructions for the task"),
    context: v.record(v.string(), getJsonValueSchema()).optional().describe(
      "Structured data payload for the child task. Use this for critical facts and records the child must act on.",
    ),
    evidence_refs: v.array(getHostedChildForkEvidenceRefSchema()).optional().describe(
      "Generic source-of-truth references for facts the child must preserve. " +
        "Use run_id/message_id/tool_call_id plus result_path instead of copying critical facts as prose.",
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
    | "description"
    | "prompt"
    | "context"
    | "evidence_refs"
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

function appendEvidenceRefsToPrompt(
  prompt: string,
  evidenceRefs: HostedChildForkToolInput["evidence_refs"],
): string {
  if (!evidenceRefs || evidenceRefs.length === 0) {
    return prompt;
  }

  return `${prompt}\n\n<evidence_refs>\n${
    JSON.stringify(evidenceRefs)
  }\n</evidence_refs>\nTreat these references as source-of-truth pointers. If prose conflicts with referenced evidence, prefer the referenced evidence and say what conflicted.`;
}

function hasStructuredContext(context: HostedChildForkToolInput["context"]): boolean {
  return context !== undefined && Object.keys(context).length > 0;
}

function appendStructuredContextToPrompt(
  prompt: string,
  context: HostedChildForkToolInput["context"],
): string {
  if (!hasStructuredContext(context)) {
    return prompt;
  }

  return `${prompt}\n\n<structured_context>\n${
    JSON.stringify(context)
  }\n</structured_context>\nTreat structured_context as the authoritative data payload for the child task. If prose conflicts with structured_context, use structured_context and say what conflicted.`;
}

/** Configuration used by resolve hosted child fork runtime. */
export function resolveHostedChildForkRuntimeConfig(
  input: ResolveHostedChildForkRuntimeConfigInput,
): HostedChildForkRuntimeConfig {
  const { description, prompt, context, evidence_refs, tools, model, thinking, max_steps } =
    input.forkInput;
  const forkModel = input.resolveModelId(model || input.contextModel || input.defaultModel);
  const requestedMaxSteps = typeof max_steps === "number" ? max_steps : undefined;
  const promptWithArtifactPath = withDefaultResearchArtifactPath({
    description,
    prompt,
    runId: input.runId,
  });

  return {
    description,
    effectivePrompt: appendEvidenceRefsToPrompt(
      appendStructuredContextToPrompt(promptWithArtifactPath, context),
      evidence_refs,
    ),
    requestedTools: tools,
    forkModel,
    provider: input.resolveProvider(forkModel),
    maxSteps: Math.max(requestedMaxSteps ?? input.defaultMaxSteps, input.defaultMaxSteps),
    thinkingConfig: resolveHostedChildForkThinkingOverride(thinking),
  };
}
