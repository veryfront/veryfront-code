import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGitHubClient } from "../../lib/github-client.ts";

export default tool({
  id: "list-prs",
  description: "List pull requests for a GitHub repository",
  inputSchema: z.object({
    repo: z
      .string()
      .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
    state: z
      .enum(["open", "closed", "all"])
      .default("open")
      .describe("State of pull requests to list"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of pull requests to return"),
  }),
  execute: async ({ repo, state, limit }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return {
        error: "Invalid repository format. Use 'owner/repo' format.",
      };
    }

    try {
      const github = createGitHubClient(userId);
      const prs = await github.listPullRequests(owner, repoName, {
        state,
        perPage: limit,
      });

      return {
        pullRequests: prs.map((
          pr: {
            number: number;
            title: string;
            state: string;
            draft: boolean;
            html_url: string;
            user: { login: string };
            created_at: string;
            updated_at: string;
            head: { ref: string };
            base: { ref: string };
            additions: number;
            deletions: number;
            changed_files: number;
            labels: Array<{ name: string }>;
          },
        ) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          isDraft: pr.draft,
          url: pr.html_url,
          author: pr.user.login,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          sourceBranch: pr.head.ref,
          targetBranch: pr.base.ref,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
          labels: pr.labels.map((l: { name: string }) => l.name),
        })),
        count: prs.length,
        repository: repo,
        message: `Found ${prs.length} ${state} pull request(s) in ${repo}.`,
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
