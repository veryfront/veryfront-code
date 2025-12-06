import { tool } from "veryfront/ai";
import { z } from "zod";
import { createGitHubClient } from "../../lib/github-client.ts";

export default tool({
  id: "get-pr-diff",
  description: "Get the diff for a pull request to review code changes",
  inputSchema: z.object({
    repo: z
      .string()
      .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
    prNumber: z
      .number()
      .int()
      .positive()
      .describe("Pull request number"),
  }),
  execute: async ({ repo, prNumber }, context) => {
    const userId = context?.userId as string | undefined;
    if (!userId) {
      return {
        error: "User not authenticated. Please log in first.",
      };
    }

    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return {
        error: "Invalid repository format. Use 'owner/repo' format.",
      };
    }

    try {
      const github = createGitHubClient(userId);

      // Get PR details first
      const pr = await github.getPullRequest(owner, repoName, prNumber);

      // Get the diff
      const diff = await github.getPullRequestDiff(owner, repoName, prNumber);

      // Truncate very long diffs
      const maxDiffLength = 50000;
      const truncatedDiff = diff.length > maxDiffLength
        ? diff.substring(0, maxDiffLength) +
          `\n\n... (diff truncated, ${diff.length - maxDiffLength} characters remaining)`
        : diff;

      return {
        pullRequest: {
          number: pr.number,
          title: pr.title,
          author: pr.user.login,
          url: pr.html_url,
          sourceBranch: pr.head.ref,
          targetBranch: pr.base.ref,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
          isDraft: pr.draft,
          state: pr.state,
        },
        diff: truncatedDiff,
        stats: {
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
        },
        message:
          `Retrieved diff for PR #${prNumber} (${pr.additions} additions, ${pr.deletions} deletions across ${pr.changed_files} files).`,
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
