import { tool } from "veryfront/ai";
import { z } from "zod";
import { createBitbucketClient } from "../../lib/bitbucket-client.ts";

export default tool({
  id: "list-pull-requests",
  description: "List pull requests for a Bitbucket repository",
  inputSchema: z.object({
    workspace: z
      .string()
      .describe("Workspace name or UUID"),
    repoSlug: z
      .string()
      .describe("Repository slug (e.g., 'my-repo')"),
    state: z
      .enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
      .default("OPEN")
      .describe("State of pull requests to list"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of pull requests to return"),
  }),
  execute: async ({ workspace, repoSlug, state, limit }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const bitbucket = createBitbucketClient(userId);
      const prs = await bitbucket.listPullRequests(workspace, repoSlug, {
        state,
        perPage: limit,
      });

      return {
        pullRequests: prs.map((
          pr: {
            id: number;
            title: string;
            state: string;
            author: {
              username: string;
              display_name: string;
            };
            created_on: string;
            updated_on: string;
            source: {
              branch: { name: string };
            };
            destination: {
              branch: { name: string };
            };
            links: {
              html: { href: string };
            };
            comment_count: number;
            task_count: number;
          },
        ) => ({
          id: pr.id,
          title: pr.title,
          state: pr.state,
          author: {
            username: pr.author.username,
            displayName: pr.author.display_name,
          },
          url: pr.links.html.href,
          sourceBranch: pr.source.branch.name,
          destinationBranch: pr.destination.branch.name,
          commentCount: pr.comment_count,
          taskCount: pr.task_count,
          createdOn: pr.created_on,
          updatedOn: pr.updated_on,
        })),
        count: prs.length,
        repository: `${workspace}/${repoSlug}`,
        message: `Found ${prs.length} ${state} pull request(s) in ${workspace}/${repoSlug}.`,
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
