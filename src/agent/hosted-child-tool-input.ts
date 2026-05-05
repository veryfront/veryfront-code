import { z } from "zod";

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
