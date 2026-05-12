import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listIssues } from "../../lib/sentry-client.ts";

export default tool({
  id: "list-issues",
  description:
    "List issues/errors in a Sentry project with optional filters. Returns issue details including title, status, error count, and last seen date.",
  inputSchema: defineSchema((v) => v.object({
    projectSlug: v.string().describe("The slug of the project to list issues from"),
    query: v.string().optional().describe("Search query to filter issues (e.g., 'is:unresolved')"),
    status: v.enum(["resolved", "unresolved", "ignored"]).optional().describe("Filter by issue status"),
    sort: v
      .enum(["date", "new", "freq", "priority", "user"])
      .optional()
      .describe(
        "Sort order: date (most recent), new (newest), freq (most frequent), priority, user (most users affected)",
      ),
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(25)
      .describe("Maximum number of issues to return (1-100)"),
  }))(),
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
