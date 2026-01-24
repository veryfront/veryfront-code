import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGitHubClient } from "../../lib/github-client.ts";

type GitHubRepo = {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
};

export default tool({
  id: "list-repos",
  description: "List GitHub repositories for the authenticated user",
  inputSchema: z.object({
    type: z
      .enum(["all", "owner", "public", "private", "member"])
      .default("all")
      .describe("Type of repositories to list"),
    sort: z
      .enum(["created", "updated", "pushed", "full_name"])
      .default("updated")
      .describe("How to sort the repositories"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of repositories to return"),
  }),
  execute: async ({ type, sort, limit }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = context?.userId ?? "current-user";

    try {
      const github = createGitHubClient(userId);
      const repos = await github.listRepos({ type, sort, perPage: limit });

      return {
        repositories: repos.map((repo: GitHubRepo) => ({
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description ?? null,
          isPrivate: repo.private,
          url: repo.html_url,
          defaultBranch: repo.default_branch,
          language: repo.language,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          openIssues: repo.open_issues_count,
          updatedAt: repo.updated_at,
        })),
        count: repos.length,
        message: `Found ${repos.length} repository(s).`,
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
