import { tool } from "veryfront/tool";
import { z } from "zod";
import {
  getIssue,
  getIssueTransitions,
  transitionIssue,
  updateIssue,
} from "../../lib/jira-client.ts";

export default tool({
  id: "update-issue",
  description:
    'Update an existing Jira issue. Can update fields like summary, description, priority, assignee, labels, or transition the status (e.g., move to "In Progress", "Done").',
  inputSchema: z.object({
    issueKey: z.string().describe('The issue key (e.g., "PROJ-123") to update'),
    summary: z.string().optional().describe("New summary/title for the issue"),
    description: z.string().optional().describe("New description for the issue"),
    priority: z
      .string()
      .optional()
      .describe('New priority: "Highest", "High", "Medium", "Low", "Lowest"'),
    assigneeId: z
      .string()
      .optional()
      .describe("Atlassian account ID of the new assignee"),
    labels: z
      .array(z.string())
      .optional()
      .describe("New array of labels (replaces existing labels)"),
    status: z
      .string()
      .optional()
      .describe(
        'New status to transition to (e.g., "In Progress", "Done", "To Do")',
      ),
  }),
  async execute({
    issueKey,
    summary,
    description,
    priority,
    assigneeId,
    labels,
    status,
  }) {
    if (
      summary !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      assigneeId !== undefined ||
      labels !== undefined
    ) {
      await updateIssue(issueKey, {
        summary,
        description,
        priority,
        assigneeId,
        labels,
      });
    }

    if (status) {
      const transitions = await getIssueTransitions(issueKey);
      const normalizedStatus = status.toLowerCase();

      const targetTransition = transitions.find((t) => {
        const transitionName = t.name.toLowerCase();
        const toName = t.to.name.toLowerCase();
        return transitionName === normalizedStatus || toName === normalizedStatus;
      });

      if (!targetTransition) {
        const available = transitions.map((t) => t.to.name).join(", ");
        throw new Error(
          `Status "${status}" not found. Available transitions: ${available}`,
        );
      }

      await transitionIssue(issueKey, targetTransition.id);
    }

    const updatedIssue = await getIssue(issueKey);

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
