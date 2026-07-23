import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitLabClient } from "../lib/gitlab-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "add-issue-comment",
  description: "Add a Markdown comment/note to a GitLab issue.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectId: v
        .union([v.number(), v.string()])
        .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
      issueIid: v
        .number()
        .describe(
          "Issue IID (the project-local number shown in the issue URL)",
        ),
      body: v.string().min(1).describe("Comment body in Markdown"),
      confidential: v.boolean().optional().describe(
        "Make the note confidential",
      ),
    })
  )(),
  async execute({ projectId, issueIid, body, confidential }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createGitLabClient(userId);
    const note = await client.addIssueComment(projectId, issueIid, {
      body,
      confidential,
    });

    return {
      success: true,
      message: `Comment added to issue #${issueIid}.`,
      note,
    };
  },
});
