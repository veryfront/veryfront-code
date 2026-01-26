import { tool } from "veryfront/tool";
import { z } from "zod";
import { createIssue } from "../../lib/jira-client.ts";

export default tool({
  id: "create-issue",
  description:
    "Create a new Jira issue in a project. Requires project key, summary, and issue type. Optionally set description, priority, assignee, and labels.",
  inputSchema: z.object({
    projectKey: z.string().describe('The project key (e.g., "PROJ", "DEV")'),
    summary: z.string().describe("Brief summary/title of the issue"),
    issueType: z.string().describe('Type of issue: "Task", "Bug", "Story", "Epic", etc.'),
    description: z.string().optional().describe("Detailed description of the issue"),
    priority: z
      .string()
      .optional()
      .describe('Priority: "Highest", "High", "Medium", "Low", "Lowest"'),
    assigneeId: z.string().optional().describe("Atlassian account ID of the assignee (optional)"),
    labels: z.array(z.string()).optional().describe("Array of labels to add to the issue"),
  }),
  async execute({ projectKey, summary, issueType, description, priority, assigneeId, labels }) {
    const issue = await createIssue({
      projectKey,
      summary,
      issueType,
      description,
      priority,
      assigneeId,
      labels,
    });

    const { fields } = issue;

    return {
      key: issue.key,
      id: issue.id,
      summary: fields.summary,
      status: fields.status.name,
      type: fields.issuetype.name,
      priority: fields.priority?.name,
      assignee: fields.assignee?.displayName,
      project: {
        key: fields.project.key,
        name: fields.project.name,
      },
      created: fields.created,
      message: `Issue ${issue.key} created successfully`,
    };
  },
});
