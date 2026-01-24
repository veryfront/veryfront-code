import { tool } from "veryfront/tool";
import { z } from "zod";
import { updateIssue } from "../../lib/linear-client.ts";

export default tool({
  id: "update-issue",
  description:
    "Update an existing Linear issue. You can change the title, description, status, priority, assignee, project, or labels.",
  inputSchema: z.object({
    issueId: z.string().describe("The ID of the issue to update"),
    title: z.string().optional().describe("New title for the issue"),
    description: z
      .string()
      .optional()
      .describe("New description for the issue (supports markdown)"),
    priority: z
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe("New priority level: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low"),
    stateId: z.string().optional().describe("New workflow state ID to move the issue to"),
    assigneeId: z
      .string()
      .optional()
      .describe("User ID to assign the issue to (or null to unassign)"),
    projectId: z.string().optional().describe("Project ID to move the issue to"),
    labelIds: z
      .array(z.string())
      .optional()
      .describe("New array of label IDs (replaces existing labels)"),
  }),
  async execute(
    { issueId, title, description, priority, stateId, assigneeId, projectId, labelIds },
  ) {
    const issue = await updateIssue(issueId, {
      title,
      description,
      priority,
      stateId,
      assigneeId,
      projectId,
      labelIds,
    });

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priorityLabel,
      status: issue.state.name,
      statusType: issue.state.type,
      assignee: issue.assignee
        ? { name: issue.assignee.name, email: issue.assignee.email }
        : null,
      team: {
        name: issue.team.name,
        key: issue.team.key,
      },
      project: issue.project ? { name: issue.project.name } : null,
      labels: issue.labels.nodes.map((label) => ({
        name: label.name,
        color: label.color,
      })),
      url: issue.url,
      updatedAt: issue.updatedAt,
    };
  },
});
