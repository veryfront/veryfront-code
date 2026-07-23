import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "create-issue",
  description:
    "Create a new Jira issue in a project. Requires project key, summary, and issue type. Optionally set description, priority, assignee, and labels.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectKey: v.string().describe('The project key (e.g., "PROJ", "DEV")'),
      summary: v.string().describe("Brief summary/title of the issue"),
      issueType: v.string().describe(
        'Type of issue: "Task", "Bug", "Story", "Epic", etc.',
      ),
      description: v.string().optional().describe(
        "Detailed description of the issue",
      ),
      priority: v
        .string()
        .optional()
        .describe('Priority: "Highest", "High", "Medium", "Low", "Lowest"'),
      assigneeId: v.string().optional().describe(
        "Atlassian account ID of the assignee (optional)",
      ),
      labels: v.array(v.string()).optional().describe(
        "Array of labels to add to the issue",
      ),
    })
  )(),
  async execute(
    {
      projectKey,
      summary,
      issueType,
      description,
      priority,
      assigneeId,
      labels,
    },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const { key, id, fields } = await client.createIssue({
      projectKey,
      summary,
      issueType,
      description,
      priority,
      assigneeId,
      labels,
    });

    return {
      key,
      id,
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
      message: `Issue ${key} created successfully`,
    };
  },
});
