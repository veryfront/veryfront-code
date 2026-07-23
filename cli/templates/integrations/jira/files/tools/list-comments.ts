import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-comments",
  description: "List comments on a Jira issue.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueKey: v.string().describe('The issue key (e.g., "PROJ-123") or ID'),
      startAt: v.number().min(0).default(0).describe("Pagination offset"),
      maxResults: v.number().min(1).max(100).default(50).describe(
        "Maximum comments to return",
      ),
    })
  )(),
  async execute({ issueKey, startAt, maxResults }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const result = await client.listComments(issueKey, { startAt, maxResults });

    return {
      total: result.total,
      startAt: result.startAt,
      maxResults: result.maxResults,
      comments: result.comments.map((comment) => ({
        id: comment.id,
        author: comment.author?.displayName,
        body: client.extractDescriptionText(comment.body),
        created: comment.created,
        updated: comment.updated,
      })),
    };
  },
});
