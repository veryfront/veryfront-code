import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { optionalAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const MERGE_METHODS = ["merge", "squash", "rebase"] as const;

export default tool({
  id: "merge-pr",
  description: "Merge an open GitHub pull request",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      pull_number: v
        .number()
        .int()
        .positive()
        .describe("Pull request number to merge"),
      merge_method: v
        .enum(["merge", "squash", "rebase"])
        .default("merge")
        .optional()
        .describe("Merge method: merge, squash, or rebase"),
      commit_title: v
        .string()
        .optional()
        .describe("Title for the merge commit"),
      commit_message: v
        .string()
        .optional()
        .describe("Extra detail for the merge commit message"),
    })
  )(),
  execute: async (
    { repo, pull_number, merge_method, commit_title, commit_message },
    context,
  ) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");

    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const result = await github.mergePullRequest(
        owner,
        repoName,
        pull_number,
        {
          merge_method: optionalAllowedValue(
            merge_method,
            MERGE_METHODS,
            "merge_method",
          ),
          commit_title,
          commit_message,
        },
      );

      return {
        success: result.merged,
        sha: result.sha,
        message: result.message,
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
