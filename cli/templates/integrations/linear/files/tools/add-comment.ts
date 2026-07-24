import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createLinearClient } from "../lib/linear-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "linear-add-comment",
  description: "Add a comment to a Linear issue.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueId: v.string().describe("Linear issue ID"),
      body: v.string().min(1).describe("Comment body in markdown"),
    })
  )(),
  async execute({ issueId, body }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createLinearClient(userId);
    const comment = await client.addComment({ issueId, body });

    return {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      user: comment.user
        ? { id: comment.user.id, name: comment.user.name }
        : null,
      issue: comment.issue
        ? {
          id: comment.issue.id,
          identifier: comment.issue.identifier,
          title: comment.issue.title,
        }
        : null,
    };
  },
});
