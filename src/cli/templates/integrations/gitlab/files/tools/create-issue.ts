import { tool } from "veryfront/tool";
import { z } from "zod";
import { createIssue } from "../../lib/gitlab-client.ts";

export default tool({
  id: "create-issue",
  description:
    "Create a new issue in a GitLab project. Can set title, description, labels, assignees, milestone, and due date.",
  inputSchema: z.object({
    projectId: z.union([z.number(), z.string()]).describe(
      'Project ID or path (e.g., "gitlab-org/gitlab" or 278964)',
    ),
    title: z.string().min(1).describe("Issue title"),
    description: z.string().optional().describe("Issue description in Markdown format"),
    labels: z.array(z.string()).optional().describe('Labels to apply (e.g., ["bug", "urgent"])'),
    assigneeIds: z.array(z.number()).optional().describe("User IDs to assign the issue to"),
    milestoneId: z.number().optional().describe("Milestone ID to associate with the issue"),
    dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
  }),
  async execute({ projectId, title, description, labels, assigneeIds, milestoneId, dueDate }) {
    const issue = await createIssue(projectId, {
      title,
      description,
      labels,
      assigneeIds,
      milestoneId,
      dueDate,
    });

    return {
      success: true,
      message: `Issue created successfully: #${issue.iid}`,
      issue: {
        id: issue.id,
        iid: issue.iid,
        projectId: issue.project_id,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees.map(({ username, name }) => ({ username, name })),
        webUrl: issue.web_url,
        createdAt: issue.created_at,
      },
    };
  },
});
