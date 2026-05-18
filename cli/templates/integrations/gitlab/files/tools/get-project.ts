import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getProject } from "../../lib/gitlab-client.ts";

export default tool({
  id: "get-project",
  description: "Get detailed information about a GitLab project.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectId: v
        .union([v.number(), v.string()])
        .describe('Project ID or path (e.g., "gitlab-org/gitlab" or 278964)'),
    })
  )(),
  async execute({ projectId }) {
    const project = await getProject(projectId);

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
