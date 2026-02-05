/**
 * Agent Tool Schemas
 *
 * Zod schemas for agent tool validation.
 */

import { z } from "zod";

/**
 * Schema for tool input when an agent is used as a tool
 */
export const AgentToolInputSchema = z.object({
  input: z.string().describe("Input for the agent"),
});

export type AgentToolInput = z.infer<typeof AgentToolInputSchema>;
