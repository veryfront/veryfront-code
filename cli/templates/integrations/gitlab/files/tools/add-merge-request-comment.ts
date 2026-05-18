import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { addMergeRequestComment } from "../../lib/gitlab-client.ts";

export default tool({
  id: "add-merge-request-comment",
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
  async execute({ projectId, mergeRequestIid, body, internal }) {
    const note = await addMergeRequestComment(projectId, mergeRequestIid, {
      body,
      internal,
    });

    return {
      success: true,
      message: `Comment added to merge request !${mergeRequestIid}.`,
      note,
    };
  },
});
