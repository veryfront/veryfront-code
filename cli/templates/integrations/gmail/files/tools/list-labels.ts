import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "list-labels",
  description: "List Gmail labels for the connected account.",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: async (_input, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const result = await gmail.listLabels();

      return {
        labels: result.labels ?? [],
        count: result.labels?.length ?? 0,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Gmail not connected. Please connect your Gmail account.",
          connectUrl: "/api/auth/gmail",
        };
      }
      throw error;
    }
  },
});
