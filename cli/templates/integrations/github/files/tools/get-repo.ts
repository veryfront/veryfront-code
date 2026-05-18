import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../../lib/github-client.ts";
import { requireUserIdFromContext } from "../../lib/user-id.ts";

export default tool({
  id: "get-repo",
  description: "Get details of a GitHub repository",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
    })
  )(),
  execute: async ({ repo }, context) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");

    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const result = await github.getRepo(owner, repoName);

      return {
        repository: {
          name: result.name,
          fullName: result.full_name,
          description: result.description ?? null,
          isPrivate: result.private,
          url: result.html_url,
          defaultBranch: result.default_branch,
          language: result.language,
          stars: result.stargazers_count,
          forks: result.forks_count,
          openIssues: result.open_issues_count,
          updatedAt: result.updated_at,
        },
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
