import { tool } from "veryfront/tool";
import { z } from "zod";
import { extractDescriptionText, searchIssues } from "../../lib/jira-client.ts";

export default tool({
  id: "search-issues",
  description:
    'Search for Jira issues using JQL (Jira Query Language). Returns matching issues with key details. Common JQL examples: "assignee = currentUser() AND status != Done", "project = PROJ AND type = Bug", "created >= -7d".',
  inputSchema: z.object({
    jql: z
      .string()
      .describe(
        'JQL query string to search issues. Examples: "assignee = currentUser()", "project = PROJ", "status = Open"',
      ),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of results to return"),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to include (e.g., ["summary", "status", "assignee"])',
      ),
  }),
  async execute({ jql, maxResults, fields }) {
    const result = await searchIssues(jql, { maxResults, fields });

    return {
      total: result.total,
      issues: result.issues.map((issue) => {
        const { fields } = issue;

        return {
          key: issue.key,
          id: issue.id,
          summary: fields.summary,
          description: extractDescriptionText(fields.description),
          status: fields.status.name,
          statusCategory: fields.status.statusCategory.name,
          type: fields.issuetype.name,
          priority: fields.priority?.name,
          assignee: fields.assignee?.displayName,
          reporter: fields.reporter?.displayName,
          project: {
            key: fields.project.key,
            name: fields.project.name,
          },
          created: fields.created,
          updated: fields.updated,
          labels: fields.labels ?? [],
        };
      }),
    };
  },
});
