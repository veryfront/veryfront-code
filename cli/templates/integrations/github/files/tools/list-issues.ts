import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const ISSUE_STATES = ["open", "closed", "all"] as const;

type GitHubIssueListItem = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
};

export default tool({
  id: "github-list-issues",
  description: "List issues for a GitHub repository",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      state: v
        .enum(["open", "closed", "all"])
        .default("open")
        .describe("State of issues to list"),
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of issues to return"),
    })
  )(),
  execute: async ({ repo, state, limit }, context) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");

    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const issues = await github.listIssues(owner, repoName, {
        state: requireAllowedValue(state, ISSUE_STATES, "state"),
        perPage: limit,
      });

      return {
        issues: issues.map((issue: GitHubIssueListItem) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          url: issue.html_url,
          author: issue.user.login,
          labels: issue.labels.map((label) => label.name),
          assignees: issue.assignees.map((assignee) => assignee.login),
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
        })),
        count: issues.length,
        repository: repo,
        message: `Found ${issues.length} ${state} issue(s) in ${repo}.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "GitHub not connected. Please connect your GitHub account.",
          connectUrl: "/api/auth/github",
        };
      }
      throw error;
    }
  },
});
