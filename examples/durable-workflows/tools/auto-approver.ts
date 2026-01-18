import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Auto-approve content when manual approval is not required",
  inputSchema: z.object({
    approved: z.boolean().default(true).describe("Whether to approve the content"),
  }),
  execute: async ({ approved }) => {
    return {
      approved,
      approvedAt: new Date().toISOString(),
      approvedBy: "system",
      reason: approved ? "Auto-approved (no manual review required)" : "Auto-rejected",
    };
  },
});
