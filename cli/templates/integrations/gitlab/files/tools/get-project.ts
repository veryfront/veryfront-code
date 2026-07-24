import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitLabClient } from "../lib/gitlab-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "gitlab-get-project",
  description: "Get detailed information about a GitLab project.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectId: v
        .union([v.number(), v.string()])
        .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
    })
  )(),
  async execute({ projectId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createGitLabClient(userId);
    const project = await client.getProject(projectId);

    return {
      id: project.id,
      name: project.name,
      nameWithNamespace: project.name_with_namespace,
      description: project.description ?? "No description",
      path: project.path_with_namespace,
      visibility: project.visibility,
      defaultBranch: project.default_branch,
      webUrl: project.web_url,
      createdAt: project.created_at,
      lastActivityAt: project.last_activity_at,
    };
  },
});
