import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitLabClient } from "../lib/gitlab-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "get-issue",
  description:
    "Get detailed information about a specific GitLab issue including full description, comments, time tracking, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectId: v
        .union([v.number(), v.string()])
        .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
      issueIid: v
        .number()
        .describe(
          "Issue IID (internal ID, the number shown in the issue URL like #123)",
        ),
    })
  )(),
  async execute({ projectId, issueIid }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createGitLabClient(userId);
    const issue = await client.getIssue(projectId, issueIid);

    return {
      id: issue.id,
      iid: issue.iid,
      projectId: issue.project_id,
      title: issue.title,
      description: issue.description ?? "No description provided",
      state: issue.state,
      labels: issue.labels,
      milestone: issue.milestone
        ? { id: issue.milestone.id, title: issue.milestone.title }
        : null,
      assignees: issue.assignees.map(({ id, username, name, avatar_url }) => ({
        id,
        username,
        name,
        avatarUrl: avatar_url,
      })),
      author: {
        id: issue.author.id,
        username: issue.author.username,
        name: issue.author.name,
        avatarUrl: issue.author.avatar_url,
      },
      timeStats: {
        timeEstimate: issue.time_stats.time_estimate,
        totalTimeSpent: issue.time_stats.total_time_spent,
      },
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      webUrl: issue.web_url,
    };
  },
});
