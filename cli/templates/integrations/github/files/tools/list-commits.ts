import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient, type GitHubCommit } from "../../lib/github-client.ts";
import { requireUserIdFromContext } from "../../lib/user-id.ts";

export default tool({
  id: "list-commits",
  description: "List commits for a repository, branch, or file path",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      sha: v
        .string()
        .optional()
        .describe("Branch name or commit SHA to list commits from"),
      path: v
        .string()
        .optional()
        .describe("Only include commits that touch this file path"),
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(30)
        .describe("Maximum number of commits to return"),
    })
  )(),
  execute: async ({ repo, sha, path, limit }, context) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");

    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const commits = await github.listCommits(owner, repoName, {
        sha,
        path,
        perPage: limit,
      });

      return {
        commits: commits.map((c: GitHubCommit) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split("\n")[0],
          author: c.author?.login ?? c.commit.author.name,
          date: c.commit.author.date,
          url: c.html_url,
        })),
        count: commits.length,
        repository: repo,
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
