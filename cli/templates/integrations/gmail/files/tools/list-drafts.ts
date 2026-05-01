import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "list-drafts",
  description: "List Gmail draft messages.",
  inputSchema: z.object({
    maxResults: z.number().min(1).max(500).default(10).describe("Maximum number of drafts"),
    query: z.string().optional().describe("Gmail search query"),
    pageToken: z.string().optional().describe("Page token for pagination"),
  }),
  execute: async ({ maxResults, query, pageToken }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const result = await gmail.listDrafts({ maxResults, query, pageToken });

      return {
        drafts: result.drafts ?? [],
        nextPageToken: result.nextPageToken,
        resultSizeEstimate: result.resultSizeEstimate,
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
