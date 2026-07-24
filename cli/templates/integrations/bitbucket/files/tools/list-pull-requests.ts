import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createBitbucketClient } from "../lib/bitbucket-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const PULL_REQUEST_STATES = [
  "OPEN",
  "MERGED",
  "DECLINED",
  "SUPERSEDED",
] as const;

type PullRequest = {
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
};

export default tool({
  id: "bitbucket-list-pull-requests",
  description: "List pull requests for a Bitbucket repository",
  inputSchema: defineSchema((v) =>
    v.object({
      workspace: v.string().describe("Workspace name or UUID"),
      repoSlug: v.string().describe("Repository slug (e.g., 'my-repo')"),
      state: v
        .enum(PULL_REQUEST_STATES)
        .default("OPEN")
        .describe("State of pull requests to list"),
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Maximum number of pull requests to return"),
    })
  )(),
  execute: async ({ workspace, repoSlug, state, limit }, context) => {
    const userId = requireUserIdFromContext(context);

    try {
      const bitbucket = createBitbucketClient(userId);
      const prs = await bitbucket.listPullRequests(workspace, repoSlug, {
        state: requireAllowedValue(
          state,
          PULL_REQUEST_STATES,
          "pull request state",
        ),
        perPage: limit,
      });

      const repository = `${workspace}/${repoSlug}`;

      return {
        pullRequests: prs.map((pr: PullRequest) => ({
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
        repository,
        message:
          `Found ${prs.length} ${state} pull request(s) in ${repository}.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error:
            "Bitbucket not connected. Please connect your Bitbucket account.",
          connectUrl: "/api/auth/bitbucket",
        };
      }
      throw error;
    }
  },
});
