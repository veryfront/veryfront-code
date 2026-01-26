import { tool } from "veryfront/tool";
import { z } from "zod";
import { extractDescriptionText, getIssue } from "../../lib/jira-client.ts";

export default tool({
  id: "get-issue",
  description:
    "Get detailed information about a specific Jira issue by its key (e.g., PROJ-123) or ID. Returns all fields including description, comments, history, etc.",
  inputSchema: z.object({
    issueKey: z.string().describe('The issue key (e.g., "PROJ-123") or ID'),
  }),
  async execute({ issueKey }) {
    const issue = await getIssue(issueKey);
    const { fields } = issue;

    return {
      key: issue.key,
      id: issue.id,
      summary: fields.summary,
      description: extractDescriptionText(fields.description),
      status: fields.status.name,
      statusCategory: fields.status.statusCategory.name,
      type: {
        name: fields.issuetype.name,
        iconUrl: fields.issuetype.iconUrl,
      },
      priority: fields.priority
        ? {
            name: fields.priority.name,
            iconUrl: fields.priority.iconUrl,
          }
        : null,
      assignee: fields.assignee
        ? {
            displayName: fields.assignee.displayName,
            email: fields.assignee.emailAddress,
            accountId: fields.assignee.accountId,
          }
        : null,
      reporter: fields.reporter
        ? {
            displayName: fields.reporter.displayName,
            email: fields.reporter.emailAddress,
            accountId: fields.reporter.accountId,
          }
        : null,
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
