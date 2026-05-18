import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import {
  formatMergeRequestForDisplay,
  getMergeRequest,
} from "../../lib/gitlab-client.ts";

export default tool({
  id: "get-merge-request",
  description:
    "Get detailed information about a specific GitLab merge request.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectId: v
        .union([v.number(), v.string()])
        .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
      mergeRequestIid: v
        .number()
        .describe(
          "Merge request IID (the project-local number shown in the MR URL)",
        ),
    })
  )(),
  async execute({ projectId, mergeRequestIid }) {
    const mr = await getMergeRequest(projectId, mergeRequestIid);

    return {
      id: mr.id,
      iid: mr.iid,
      projectId: mr.project_id,
      title: mr.title,
      description: mr.description ?? "No description provided",
      state: mr.state,
      draft: mr.draft,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      labels: mr.labels,
      author: { username: mr.author.username, name: mr.author.name },
      assignees: mr.assignees.map(({ username, name }) => ({ username, name })),
      reviewers: mr.reviewers.map(({ username, name }) => ({ username, name })),
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      mergedAt: mr.merged_at,
      closedAt: mr.closed_at,
      webUrl: mr.web_url,
      summary: formatMergeRequestForDisplay(mr),
    };
  },
});
