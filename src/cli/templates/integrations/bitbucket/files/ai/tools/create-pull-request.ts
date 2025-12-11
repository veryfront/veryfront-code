import { tool } from "veryfront/ai";
import { z } from "zod";
import { createBitbucketClient } from "../../lib/bitbucket-client.ts";

export default tool({
  id: "create-pull-request",
  description: "Create a new pull request in a Bitbucket repository",
  inputSchema: z.object({
    workspace: z
      .string()
      .describe("Workspace name or UUID"),
    repoSlug: z
      .string()
      .describe("Repository slug (e.g., 'my-repo')"),
    title: z
      .string()
      .min(1)
      .describe("Pull request title"),
    description: z
      .string()
      .optional()
      .describe("Pull request description (supports Markdown)"),
    sourceBranch: z
      .string()
      .describe("Source branch name"),
    destinationBranch: z
      .string()
      .describe("Destination branch name"),
    closeSourceBranch: z
      .boolean()
      .optional()
      .default(false)
      .describe("Close source branch after merge"),
  }),
  execute: async ({
    workspace,
    repoSlug,
    title,
    description,
    sourceBranch,
    destinationBranch,
    closeSourceBranch,
  }, context) => {
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const bitbucket = createBitbucketClient(userId);
      const pr = await bitbucket.createPullRequest(workspace, repoSlug, {
        title,
        description,
        sourceBranch,
        destinationBranch,
        closeSourceBranch,
      });

      return {
        success: true,
        pullRequest: {
          id: pr.id,
          title: pr.title,
          url: pr.links.html.href,
          state: pr.state,
          sourceBranch: pr.source.branch.name,
          destinationBranch: pr.destination.branch.name,
          author: {
            username: pr.author.username,
            displayName: pr.author.display_name,
          },
        },
        message: `Pull request #${pr.id} created successfully in ${workspace}/${repoSlug}.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Bitbucket not connected. Please connect your Bitbucket account.",
          connectUrl: "/api/auth/bitbucket",
        };
      }
      throw error;
    }
  },
});
