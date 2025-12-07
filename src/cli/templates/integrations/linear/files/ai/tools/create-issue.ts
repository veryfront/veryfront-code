import { tool } from "veryfront/ai";
import { z } from "zod";
import { createIssue, getTeams } from "../../lib/linear-client.ts";

export default tool({
  id: "create-issue",
  description:
    "Create a new Linear issue in a specified team. You can optionally set priority, assign to someone, add to a project, and attach labels.",
  inputSchema: z.object({
    teamId: z.string().describe(
      "The ID of the team to create the issue in. Use list-projects tool first if you need to find team IDs.",
    ),
    title: z.string().describe("Title of the issue"),
    description: z.string().optional().describe(
      "Detailed description of the issue (supports markdown)",
    ),
    priority: z.number().min(0).max(4).optional().describe(
      "Priority level: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low",
    ),
    stateId: z.string().optional().describe(
      'Workflow state ID (e.g., "Todo", "In Progress", "Done")',
    ),
    assigneeId: z.string().optional().describe("User ID to assign the issue to"),
    projectId: z.string().optional().describe("Project ID to add the issue to"),
    labelIds: z.array(z.string()).optional().describe("Array of label IDs to attach to the issue"),
  }),
  async execute(
    { teamId, title, description, priority, stateId, assigneeId, projectId, labelIds },
  ) {
    const issue = await createIssue({
      teamId,
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
      assignee: issue.assignee
        ? {
          name: issue.assignee.name,
          email: issue.assignee.email,
        }
        : null,
      team: {
        name: issue.team.name,
        key: issue.team.key,
      },
      project: issue.project
        ? {
          name: issue.project.name,
        }
        : null,
      labels: issue.labels.nodes.map((label) => ({
        name: label.name,
        color: label.color,
      })),
      url: issue.url,
      createdAt: issue.createdAt,
    };
  },
});
