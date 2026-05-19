import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../../lib/github-client.ts";
import { requireUserIdFromContext } from "../../lib/user-id.ts";

export default tool({
  id: "get-pr-diff",
  description: "Get the diff for a pull request to review code changes",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      prNumber: v.number().int().positive().describe("Pull request number"),
    })
  )(),
  execute: async ({ repo, prNumber }, context) => {
    const userId = requireUserIdFromContext(context);

    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);

      const pr = await github.getPullRequest(owner, repoName, prNumber);
      const diff = await github.getPullRequestDiff(owner, repoName, prNumber);

      const maxDiffLength = 50000;
      let truncatedDiff = diff;

      if (diff.length > maxDiffLength) {
        truncatedDiff = `${
          diff.substring(0, maxDiffLength)
        }\n\n... (diff truncated, ${
          diff.length - maxDiffLength
        } characters remaining)`;
      }

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
