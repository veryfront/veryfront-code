import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { updateIssue } from "../../lib/gitlab-client.ts";

export default tool({
  id: "update-issue",
  description: "Update, close, or reopen a GitLab issue.",
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
      title: v.string().optional().describe("Updated issue title"),
      description: v.string().optional().describe("Updated issue description"),
      state: v.enum(["opened", "closed"]).optional().describe("Issue state"),
      labels: v.array(v.string()).optional().describe("Replacement labels"),
      assigneeIds: v.array(v.number()).optional().describe(
        "GitLab user IDs to assign",
      ),
    })
  )(),
  async execute(
    { projectId, issueIid, title, description, state, labels, assigneeIds },
  ) {
    const issue = await updateIssue(projectId, issueIid, {
      title,
      description,
      state,
      labels,
      assigneeIds,
    });

    return {
      success: true,
      message: `Issue #${issue.iid} updated successfully.`,
      issue: {
        id: issue.id,
        iid: issue.iid,
        projectId: issue.project_id,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees.map(({ username, name }) => ({
          username,
          name,
        })),
        webUrl: issue.web_url,
        updatedAt: issue.updated_at,
      },
    };
  },
});
