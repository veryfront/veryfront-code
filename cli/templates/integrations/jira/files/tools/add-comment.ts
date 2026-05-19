import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { addComment, extractDescriptionText } from "../../lib/jira-client.ts";

export default tool({
  id: "add-comment",
  description: "Add a comment to a Jira issue.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueKey: v.string().describe('The issue key (e.g., "PROJ-123") or ID'),
      body: v.string().min(1).describe("Comment body text"),
    })
  )(),
  async execute({ issueKey, body }) {
    const comment = await addComment(issueKey, body);

    return {
      success: true,
      id: comment.id,
      author: comment.author?.displayName,
      body: extractDescriptionText(comment.body),
      created: comment.created,
      updated: comment.updated,
      message: `Comment added to ${issueKey}`,
    };
  },
});
