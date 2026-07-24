import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createLinearClient } from "../lib/linear-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "linear-get-issue",
  description:
    "Get detailed information about a specific Linear issue by its ID or identifier (e.g., ENG-123). Returns complete issue details including description, status, assignee, labels, and project.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueId: v
        .string()
        .describe(
          'The ID or identifier of the issue (e.g., "ENG-123" or full UUID)',
        ),
    })
  )(),
  async execute({ issueId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createLinearClient(userId);
    const issue = await client.getIssue(issueId);

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priorityLabel,
      priorityNumber: issue.priority,
      status: issue.state.name,
      statusType: issue.state.type,
      stateId: issue.state.id,
      assignee: issue.assignee
        ? {
          id: issue.assignee.id,
          name: issue.assignee.name,
          email: issue.assignee.email,
        }
        : null,
      team: {
        id: issue.team.id,
        name: issue.team.name,
        key: issue.team.key,
      },
      project: issue.project
        ? {
          id: issue.project.id,
          name: issue.project.name,
        }
        : null,
      labels: issue.labels.nodes.map(({ id, name, color }) => ({
        id,
        name,
        color,
      })),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  },
});
