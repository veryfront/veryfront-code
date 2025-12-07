import { tool } from "veryfront/ai";
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
    priority: z.string().optional().describe(
      'Priority: "Highest", "High", "Medium", "Low", "Lowest"',
    ),
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

    return {
      key: issue.key,
      id: issue.id,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      type: issue.fields.issuetype.name,
      priority: issue.fields.priority?.name,
      assignee: issue.fields.assignee?.displayName,
      project: {
        key: issue.fields.project.key,
        name: issue.fields.project.name,
      },
      created: issue.fields.created,
      message: `Issue ${issue.key} created successfully`,
    };
  },
});
