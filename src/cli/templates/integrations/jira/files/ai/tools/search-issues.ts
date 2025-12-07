import { tool } from "veryfront/ai";
import { z } from "zod";
import { extractDescriptionText, searchIssues } from "../../lib/jira-client.ts";

export default tool({
  id: "search-issues",
  description:
    'Search for Jira issues using JQL (Jira Query Language). Returns matching issues with key details. Common JQL examples: "assignee = currentUser() AND status != Done", "project = PROJ AND type = Bug", "created >= -7d".',
  inputSchema: z.object({
    jql: z.string().describe(
      'JQL query string to search issues. Examples: "assignee = currentUser()", "project = PROJ", "status = Open"',
    ),
    maxResults: z.number().min(1).max(100).default(20).describe(
      "Maximum number of results to return",
    ),
    fields: z.array(z.string()).optional().describe(
      'Specific fields to include (e.g., ["summary", "status", "assignee"])',
    ),
  }),
  async execute({ jql, maxResults, fields }) {
    const result = await searchIssues(jql, {
      maxResults,
      fields,
    });

    return {
      total: result.total,
      issues: result.issues.map((issue) => ({
        key: issue.key,
        id: issue.id,
        summary: issue.fields.summary,
        description: extractDescriptionText(issue.fields.description),
        status: issue.fields.status.name,
        statusCategory: issue.fields.status.statusCategory.name,
        type: issue.fields.issuetype.name,
        priority: issue.fields.priority?.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        project: {
          key: issue.fields.project.key,
          name: issue.fields.project.name,
        },
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels || [],
      })),
    };
  },
});
