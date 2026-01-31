import { tool } from "veryfront/tool";
import { z } from "zod";
import { listIssues } from "../../lib/sentry-client.ts";

export default tool({
  id: "list-issues",
  description:
    "List issues/errors in a Sentry project with optional filters. Returns issue details including title, status, error count, and last seen date.",
  inputSchema: z.object({
    projectSlug: z.string().describe("The slug of the project to list issues from"),
    query: z.string().optional().describe("Search query to filter issues (e.g., 'is:unresolved')"),
    status: z.enum(["resolved", "unresolved", "ignored"]).optional().describe("Filter by issue status"),
    sort: z
      .enum(["date", "new", "freq", "priority", "user"])
      .optional()
      .describe(
        "Sort order: date (most recent), new (newest), freq (most frequent), priority, user (most users affected)",
      ),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(25)
      .describe("Maximum number of issues to return (1-100)"),
  }),
  async execute({ projectSlug, query, status, sort, limit }) {
    const issues = await listIssues(projectSlug, { query, status, sort, limit });

    return issues.map((issue) => ({
      ...issue,
      status: issue.status,
      project: {
        id: issue.project.id,
        name: issue.project.name,
        slug: issue.project.slug,
      },
    }));
  },
});
