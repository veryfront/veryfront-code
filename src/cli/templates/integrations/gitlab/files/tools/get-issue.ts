import { tool } from "veryfront/tool";
import { z } from "zod";
import { getIssue } from "../../lib/gitlab-client.ts";

export default tool({
  id: "get-issue",
  description:
    "Get detailed information about a specific GitLab issue including full description, comments, time tracking, and metadata.",
  inputSchema: z.object({
    projectId: z.union([z.number(), z.string()]).describe(
      'Project ID or path (e.g., "gitlab-org/gitlab" or 278964)',
    ),
    issueIid: z.number().describe(
      "Issue IID (internal ID, the number shown in the issue URL like #123)",
    ),
  }),
  async execute({ projectId, issueIid }) {
    const issue = await getIssue(projectId, issueIid);

    return {
      id: issue.id,
      iid: issue.iid,
      projectId: issue.project_id,
      title: issue.title,
      description: issue.description || "No description provided",
      state: issue.state,
      labels: issue.labels,
      milestone: issue.milestone
        ? {
          id: issue.milestone.id,
          title: issue.milestone.title,
        }
        : null,
      assignees: issue.assignees.map((a) => ({
        id: a.id,
        username: a.username,
        name: a.name,
        avatarUrl: a.avatar_url,
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
