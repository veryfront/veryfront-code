import { tool } from "veryfront/tool";
import { z } from "zod";
import { searchIssues } from "../../lib/linear-client.ts";

export default tool({
  id: "search-issues",
  description:
    "Search for Linear issues by title or description. Returns matching issues with their details including status, assignee, and team.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find issues (searches in title and description)"),
    limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
    includeArchived: z.boolean().default(false).describe(
      "Whether to include archived issues in results",
    ),
  }),
  async execute({ query, limit, includeArchived }) {
    const issues = await searchIssues(query, {
      limit,
      includeArchived,
    });

    return issues.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priorityLabel,
      status: issue.state.name,
      statusType: issue.state.type,
      assignee: issue.assignee
        ? {
          name: issue.assignee.name,
          email: issue.assignee.email,
        }
        : null,
      team: {
        name: issue.team.name,
        key: issue.team.key,
      },
      project: issue.project
        ? {
          name: issue.project.name,
        }
        : null,
      labels: issue.labels.nodes.map((label) => ({
        name: label.name,
        color: label.color,
      })),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));
  },
});
