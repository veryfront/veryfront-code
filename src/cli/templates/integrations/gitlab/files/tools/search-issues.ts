import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatIssueForDisplay, searchIssues } from "../../lib/gitlab-client.ts";

export default tool({
  id: "search-issues",
  description:
    "Search for issues in GitLab projects. Can search across all accessible projects or within a specific project. Returns issue titles, states, assignees, and labels.",
  inputSchema: z.object({
    scope: z.enum(["created_by_me", "assigned_to_me", "all"]).default("all").describe(
      "Scope of issues to search",
    ),
    state: z.enum(["opened", "closed", "all"]).default("opened").describe(
      "State of issues to search for",
    ),
    search: z.string().optional().describe("Search query to filter issues by title or description"),
    labels: z.array(z.string()).optional().describe('Filter by labels (e.g., ["bug", "urgent"])'),
    projectId: z.union([z.number(), z.string()]).optional().describe(
      'Project ID or path (e.g., "gitlab-org/gitlab" or 278964)',
    ),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return"),
  }),
  async execute({ scope, state, search, labels, projectId, limit }) {
    const issues = await searchIssues({
      scope,
      state,
      search,
      labels,
      projectId,
      perPage: limit,
    });

    if (issues.length === 0) {
      return {
        message: "No issues found matching the criteria.",
        count: 0,
        issues: [],
      };
    }

    return {
      count: issues.length,
      issues: issues.map((issue) => ({
        id: issue.id,
        iid: issue.iid,
        projectId: issue.project_id,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees.map((a) => ({
          username: a.username,
          name: a.name,
        })),
        author: {
          username: issue.author.username,
          name: issue.author.name,
        },
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        webUrl: issue.web_url,
        description: issue.description?.substring(0, 200) +
          (issue.description && issue.description.length > 200 ? "..." : ""),
      })),
      summary: issues.map((issue) => formatIssueForDisplay(issue)).join("\n\n"),
    };
  },
});
