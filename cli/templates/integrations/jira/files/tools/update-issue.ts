import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "update-issue",
  description:
    'Update an existing Jira issue. Can update fields like summary, description, priority, assignee, labels, or transition the status (e.g., move to "In Progress", "Done").',
  inputSchema: defineSchema((v) =>
    v.object({
      issueKey: v.string().describe(
        'The issue key (e.g., "PROJ-123") to update',
      ),
      summary: v.string().optional().describe(
        "New summary/title for the issue",
      ),
      description: v.string().optional().describe(
        "New description for the issue",
      ),
      priority: v
        .string()
        .optional()
        .describe('New priority: "Highest", "High", "Medium", "Low", "Lowest"'),
      assigneeId: v
        .string()
        .optional()
        .describe("Atlassian account ID of the new assignee"),
      labels: v
        .array(v.string())
        .optional()
        .describe("New array of labels (replaces existing labels)"),
      status: v
        .string()
        .optional()
        .describe(
          'New status to transition to (e.g., "In Progress", "Done", "To Do")',
        ),
    })
  )(),
  async execute({
    issueKey,
    summary,
    description,
    priority,
    assigneeId,
    labels,
    status,
  }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    if (
      summary !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      assigneeId !== undefined ||
      labels !== undefined
    ) {
      await client.updateIssue(issueKey, {
        summary,
        description,
        priority,
        assigneeId,
        labels,
      });
    }

    if (status) {
      const transitions = await client.getIssueTransitions(issueKey);
      const normalizedStatus = status.toLowerCase();

      const targetTransition = transitions.find((t) => {
        const transitionName = t.name.toLowerCase();
        const toName = t.to.name.toLowerCase();
        return transitionName === normalizedStatus ||
          toName === normalizedStatus;
      });

      if (!targetTransition) {
        const available = transitions.map((t) => t.to.name).join(", ");
        throw new Error(
          `Status "${status}" not found. Available transitions: ${available}`,
        );
      }

      await client.transitionIssue(issueKey, targetTransition.id);
    }

    const updatedIssue = await client.getIssue(issueKey);

    return {
      key: updatedIssue.key,
      id: updatedIssue.id,
      summary: updatedIssue.fields.summary,
      status: updatedIssue.fields.status.name,
      type: updatedIssue.fields.issuetype.name,
      priority: updatedIssue.fields.priority?.name,
      assignee: updatedIssue.fields.assignee?.displayName,
      project: {
        key: updatedIssue.fields.project.key,
        name: updatedIssue.fields.project.name,
      },
      updated: updatedIssue.fields.updated,
      labels: updatedIssue.fields.labels ?? [],
      message: `Issue ${issueKey} updated successfully`,
    };
  },
});
