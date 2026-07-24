import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitLabClient } from "../lib/gitlab-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "gitlab-add-merge-request-comment",
  description: "Add a Markdown comment/note to a GitLab merge request.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectId: v
        .union([v.number(), v.string()])
        .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
      mergeRequestIid: v
        .number()
        .describe(
          "Merge request IID (the project-local number shown in the MR URL)",
        ),
      body: v.string().min(1).describe("Comment body in Markdown"),
      internal: v.boolean().optional().describe(
        "Make the note internal when supported",
      ),
    })
  )(),
  async execute({ projectId, mergeRequestIid, body, internal }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createGitLabClient(userId);
    const note = await client.addMergeRequestComment(
      projectId,
      mergeRequestIid,
      {
        body,
        internal,
      },
    );

    return {
      success: true,
      message: `Comment added to merge request !${mergeRequestIid}.`,
      note,
    };
  },
});
