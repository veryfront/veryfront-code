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

    return {
      key: issue.key,
      id: issue.id,
      summary: issue.fields.summary,
      description: extractDescriptionText(issue.fields.description),
      status: issue.fields.status.name,
      statusCategory: issue.fields.status.statusCategory.name,
      type: {
        name: issue.fields.issuetype.name,
        iconUrl: issue.fields.issuetype.iconUrl,
      },
      priority: issue.fields.priority
        ? {
          name: issue.fields.priority.name,
          iconUrl: issue.fields.priority.iconUrl,
        }
        : null,
      assignee: issue.fields.assignee
        ? {
          displayName: issue.fields.assignee.displayName,
          email: issue.fields.assignee.emailAddress,
          accountId: issue.fields.assignee.accountId,
        }
        : null,
      reporter: issue.fields.reporter
        ? {
          displayName: issue.fields.reporter.displayName,
          email: issue.fields.reporter.emailAddress,
          accountId: issue.fields.reporter.accountId,
        }
        : null,
      project: {
        key: issue.fields.project.key,
        name: issue.fields.project.name,
        id: issue.fields.project.id,
      },
      created: issue.fields.created,
      updated: issue.fields.updated,
      labels: issue.fields.labels || [],
      url: issue.self,
    };
  },
});
