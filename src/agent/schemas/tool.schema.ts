import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Input schema when an agent is used as a tool */
export const getAgentToolInputSchema = defineSchema((v) =>
  v.object({
    input: v.string().describe("Input for the agent"),
  })
);

export type AgentToolInput = InferSchema<ReturnType<typeof getAgentToolInputSchema>>;
