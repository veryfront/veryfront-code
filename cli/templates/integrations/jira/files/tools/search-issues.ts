import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "jira-search-issues",
  description:
    'Search for Jira issues using JQL (Jira Query Language). Returns matching issues with key details. Common JQL examples: "assignee = currentUser() AND status != Done", "project = PROJ AND type = Bug", "created >= -7d".',
  inputSchema: defineSchema((v) =>
    v.object({
      jql: v
        .string()
        .describe(
          'JQL query string to search issues. Examples: "assignee = currentUser()", "project = PROJ", "status = Open"',
        ),
      maxResults: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of results to return"),
      fields: v
        .array(v.string())
        .optional()
        .describe(
          'Specific fields to include (e.g., ["summary", "status", "assignee"])',
        ),
    })
  )(),
  async execute({ jql, maxResults, fields }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const result = await client.searchIssues(jql, { maxResults, fields });

    return {
      total: result.total,
      issues: result.issues.map((issue) => {
        const issueFields = issue.fields;

        return {
          key: issue.key,
          id: issue.id,
          summary: issueFields.summary,
          description: client.extractDescriptionText(issueFields.description),
          status: issueFields.status.name,
          statusCategory: issueFields.status.statusCategory.name,
          type: issueFields.issuetype.name,
          priority: issueFields.priority?.name,
          assignee: issueFields.assignee?.displayName,
          reporter: issueFields.reporter?.displayName,
          project: {
            key: issueFields.project.key,
            name: issueFields.project.name,
          },
          created: issueFields.created,
          updated: issueFields.updated,
          labels: issueFields.labels ?? [],
        };
      }),
    };
  },
});
