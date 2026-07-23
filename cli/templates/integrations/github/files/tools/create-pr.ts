import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "create-pr",
  description: "Create a new pull request in a GitHub repository",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      title: v.string().min(1).describe("Pull request title"),
      head: v
        .string()
        .describe(
          "Branch to merge from (e.g., 'feature-branch' or 'owner:feature-branch')",
        ),
      base: v.string().describe("Branch to merge into (e.g., 'main')"),
      body: v
        .string()
        .optional()
        .describe("Pull request description (supports Markdown)"),
      draft: v
        .boolean()
        .default(false)
        .optional()
        .describe("Create as a draft pull request"),
    })
  )(),
  execute: async ({ repo, title, head, base, body, draft }, context) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");

    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const pr = await github.createPullRequest(owner, repoName, {
        title,
        head,
        base,
        body,
        draft,
      });

      return {
        success: true,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        isDraft: pr.draft,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        message: `Pull request #${pr.number} created successfully in ${repo}.`,
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
