import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "jira-get-issue",
  description:
    "Get detailed information about a specific Jira issue by its key (e.g., PROJ-123) or ID. Returns all fields including description, comments, history, etc.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueKey: v.string().describe('The issue key (e.g., "PROJ-123") or ID'),
    })
  )(),
  async execute({ issueKey }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const issue = await client.getIssue(issueKey);
    const { fields } = issue;

    const priority = fields.priority
      ? { name: fields.priority.name, iconUrl: fields.priority.iconUrl }
      : null;

    const assignee = fields.assignee
      ? {
        displayName: fields.assignee.displayName,
        email: fields.assignee.emailAddress,
        accountId: fields.assignee.accountId,
      }
      : null;

    const reporter = fields.reporter
      ? {
        displayName: fields.reporter.displayName,
        email: fields.reporter.emailAddress,
        accountId: fields.reporter.accountId,
      }
      : null;

    return {
      key: issue.key,
      id: issue.id,
      summary: fields.summary,
      description: client.extractDescriptionText(fields.description),
      status: fields.status.name,
      statusCategory: fields.status.statusCategory.name,
      type: {
        name: fields.issuetype.name,
        iconUrl: fields.issuetype.iconUrl,
      },
      priority,
      assignee,
      reporter,
      project: {
        key: fields.project.key,
        name: fields.project.name,
        id: fields.project.id,
      },
      created: fields.created,
      updated: fields.updated,
      labels: fields.labels ?? [],
      url: issue.self,
    };
  },
});
