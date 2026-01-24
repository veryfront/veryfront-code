import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatMergeRequestForDisplay, listMergeRequests } from "../../lib/gitlab-client.ts";

export default tool({
  id: "list-merge-requests",
  description:
    "List merge requests in GitLab. Can filter by scope, state, labels, and specific project. Returns MR titles, states, branches, assignees, and reviewers.",
  inputSchema: z.object({
    scope: z
      .enum(["created_by_me", "assigned_to_me", "all"])
      .default("all")
      .describe("Scope of merge requests to list"),
    state: z
      .enum(["opened", "closed", "merged", "all"])
      .default("opened")
      .describe("State of merge requests to list"),
    labels: z
      .array(z.string())
      .optional()
      .describe('Filter by labels (e.g., ["feature", "review-needed"])'),
    projectId: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return"),
  }),
  async execute({ scope, state, labels, projectId, limit }) {
    const mergeRequests = await listMergeRequests({
      scope,
      state,
      labels,
      projectId,
      perPage: limit,
    });

    if (!mergeRequests.length) {
      return {
        message: "No merge requests found matching the criteria.",
        count: 0,
        mergeRequests: [],
      };
    }

    return {
      count: mergeRequests.length,
      mergeRequests: mergeRequests.map((mr) => {
        const description = mr.description ?? "";
        const truncatedDescription =
          description.substring(0, 200) + (description.length > 200 ? "..." : "");

        return {
          id: mr.id,
          iid: mr.iid,
          projectId: mr.project_id,
          title: mr.title,
          state: mr.state,
          draft: mr.draft,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          labels: mr.labels,
          author: {
            username: mr.author.username,
            name: mr.author.name,
          },
          assignees: mr.assignees.map((a) => ({
            username: a.username,
            name: a.name,
          })),
          reviewers: mr.reviewers.map((r) => ({
            username: r.username,
            name: r.name,
          })),
          createdAt: mr.created_at,
          updatedAt: mr.updated_at,
          mergedAt: mr.merged_at,
          webUrl: mr.web_url,
          description: truncatedDescription,
        };
      }),
      summary: mergeRequests.map(formatMergeRequestForDisplay).join("\n\n"),
    };
  },
});
