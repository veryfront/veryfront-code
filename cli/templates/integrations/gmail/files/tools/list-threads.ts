import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "list-threads",
  description: "List Gmail threads with optional search and label filters.",
  inputSchema: defineSchema((v) =>
    v.object({
      maxResults: v.number().min(1).max(500).default(10).describe(
        "Maximum number of threads",
      ),
      query: v.string().optional().describe("Gmail search query"),
      labelIds: v.array(v.string().min(1)).optional().describe(
        "Only return threads with these labels",
      ),
      pageToken: v.string().optional().describe("Page token for pagination"),
    })
  )(),
  execute: async ({ maxResults, query, labelIds, pageToken }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const result = await gmail.listThreads({
        maxResults,
        query,
        labelIds,
        pageToken,
      });

      return {
        threads: result.threads ?? [],
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
