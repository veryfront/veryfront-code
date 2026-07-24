import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createBitbucketClient } from "../lib/bitbucket-client.ts";
import { optionalAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const ISSUE_STATES = [
  "new",
  "open",
  "resolved",
  "on hold",
  "invalid",
  "duplicate",
  "wontfix",
  "closed",
] as const;
const ISSUE_KINDS = ["bug", "enhancement", "proposal", "task"] as const;
const ISSUE_PRIORITIES = [
  "trivial",
  "minor",
  "major",
  "critical",
  "blocker",
] as const;

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
  id: "bitbucket-list-issues",
  description: "List issues for a Bitbucket repository",
  inputSchema: defineSchema((v) =>
    v.object({
      workspace: v.string().describe("Workspace name or UUID"),
      repoSlug: v.string().describe("Repository slug (e.g., 'my-repo')"),
      state: v
        .enum(ISSUE_STATES)
        .optional()
        .describe("Filter by issue state"),
      kind: v
        .enum(ISSUE_KINDS)
        .optional()
        .describe("Filter by issue kind"),
      priority: v
        .enum(ISSUE_PRIORITIES)
        .optional()
        .describe("Filter by priority level"),
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of issues to return"),
    })
  )(),
  execute: async (
    { workspace, repoSlug, state, kind, priority, limit },
    context,
  ) => {
    const userId = requireUserIdFromContext(context);

    try {
      const bitbucket = createBitbucketClient(userId);
      const issues = await bitbucket.listIssues(workspace, repoSlug, {
        state: optionalAllowedValue(state, ISSUE_STATES, "issue state"),
        kind: optionalAllowedValue(kind, ISSUE_KINDS, "issue kind"),
        priority: optionalAllowedValue(
          priority,
          ISSUE_PRIORITIES,
          "issue priority",
        ),
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
          error:
            "Bitbucket not connected. Please connect your Bitbucket account.",
          connectUrl: "/api/auth/bitbucket",
        };
      }
      throw error;
    }
  },
});
