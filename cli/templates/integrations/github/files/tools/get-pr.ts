import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../../lib/github-client.ts";
import { requireUserIdFromContext } from "../../lib/user-id.ts";

export default tool({
  id: "get-pr",
  description: "Get details of a specific GitHub pull request",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      pull_number: v.number().int().positive().describe("Pull request number"),
    })
  )(),
  execute: async ({ repo, pull_number }, context) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");

    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const pr = await github.getPullRequest(owner, repoName, pull_number);

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        isDraft: pr.draft,
        url: pr.html_url,
        author: pr.user.login,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        mergeable: pr.mergeable,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        labels: pr.labels.map(({ name }) => name),
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
