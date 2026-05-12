import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { updateIssue } from "../../lib/linear-client.ts";

export default tool({
  id: "update-issue",
  description:
    "Update an existing Linear issue. You can change the title, description, status, priority, assignee, project, or labels.",
  inputSchema: defineSchema((v) => v.object({
    issueId: v.string().describe("The ID of the issue to update"),
    title: v.string().optional().describe("New title for the issue"),
    description: v
      .string()
      .optional()
      .describe("New description for the issue (supports markdown)"),
    priority: v
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe(
        "New priority level: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low",
      ),
    stateId: v
      .string()
      .optional()
      .describe("New workflow state ID to move the issue to"),
    assigneeId: v
      .string()
      .optional()
      .describe("User ID to assign the issue to (or null to unassign)"),
    projectId: v.string().optional().describe("Project ID to move the issue to"),
    labelIds: v
      .array(v.string())
      .optional()
      .describe("New array of label IDs (replaces existing labels)"),
  }))(),
  async execute({
    issueId,
    title,
    description,
    priority,
    stateId,
    assigneeId,
    projectId,
    labelIds,
  }) {
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
      labels: issue.labels.nodes.map(({ name, color }) => ({ name, color })),
      url: issue.url,
      updatedAt: issue.updatedAt,
    };
  },
});
