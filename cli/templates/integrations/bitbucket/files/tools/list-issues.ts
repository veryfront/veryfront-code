import { tool } from "veryfront/tool";
import { z } from "zod";
import { createBitbucketClient } from "../../lib/bitbucket-client.ts";

type BitbucketIssue = {
  id: number;
  title: string;
  state: string;
  kind: string;
  priority: string;
  created_on: string;
  updated_on: string;
  reporter: {
    username: string;
    display_name: string;
  };
  assignee: {
    username: string;
    display_name: string;
  } | null;
  links: {
    html: { href: string };
  };
  content: {
    raw: string;
  } | null;
};

export default tool({
  id: "list-issues",
  description: "List issues for a Bitbucket repository",
  inputSchema: z.object({
    workspace: z.string().describe("Workspace name or UUID"),
    repoSlug: z.string().describe("Repository slug (e.g., 'my-repo')"),
    state: z
      .enum([
        "new",
        "open",
        "resolved",
        "on hold",
        "invalid",
        "duplicate",
        "wontfix",
        "closed",
      ])
      .optional()
      .describe("Filter by issue state"),
    kind: z
      .enum(["bug", "enhancement", "proposal", "task"])
      .optional()
      .describe("Filter by issue kind"),
    priority: z
      .enum(["trivial", "minor", "major", "critical", "blocker"])
      .optional()
      .describe("Filter by priority level"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of issues to return"),
  }),
  execute: async (
    { workspace, repoSlug, state, kind, priority, limit },
    context,
  ) => {
    const userId = context?.userId ?? "current-user";

    try {
      const bitbucket = createBitbucketClient(userId);
      const issues = await bitbucket.listIssues(workspace, repoSlug, {
        state,
        kind,
        priority,
        perPage: limit,
      });

      const repository = `${workspace}/${repoSlug}`;

      return {
        issues: issues.map((issue: BitbucketIssue) => ({
          id: issue.id,
          title: issue.title,
          state: issue.state,
          kind: issue.kind,
          priority: issue.priority,
          description: issue.content?.raw ?? null,
          reporter: {
            username: issue.reporter.username,
            displayName: issue.reporter.display_name,
          },
          assignee: issue.assignee
            ? {
                username: issue.assignee.username,
                displayName: issue.assignee.display_name,
              }
            : null,
          url: issue.links.html.href,
          createdOn: issue.created_on,
          updatedOn: issue.updated_on,
        })),
        count: issues.length,
        repository,
        filters: {
          state: state ?? "all",
          kind: kind ?? "all",
          priority: priority ?? "all",
        },
        message: `Found ${issues.length} issue(s) in ${repository}.`,
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
