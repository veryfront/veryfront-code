import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "add-issue-comment",
  description: "Add a comment to a GitHub issue or pull request",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v.string().describe("Repository in format 'owner/repo'"),
      issueNumber: v.number().int().positive().describe(
        "Issue or pull request number",
      ),
      body: v.string().min(1).describe("Comment body (supports Markdown)"),
    })
  )(),
  execute: async ({ repo, issueNumber, body }, context) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const comment = await github.addIssueComment(
        owner,
        repoName,
        issueNumber,
        body,
      );
      return {
        success: true,
        comment: {
          id: comment.id,
          url: comment.html_url,
          body: comment.body,
          author: comment.user.login,
          createdAt: comment.created_at,
        },
        message: `Comment added to issue #${issueNumber} in ${repo}.`,
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
