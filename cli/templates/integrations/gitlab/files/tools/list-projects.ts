import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitLabClient } from "../lib/gitlab-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-projects",
  description:
    "List GitLab projects accessible to the authenticated user. Can search, filter by membership, and sort results.",
  inputSchema: defineSchema((v) =>
    v.object({
      search: v.string().optional().describe(
        "Search query to filter projects by name or path",
      ),
      membership: v.boolean().default(true).describe(
        "Only show projects where user is a member",
      ),
      orderBy: v
        .enum(["id", "name", "created_at", "updated_at", "last_activity_at"])
        .default("last_activity_at")
        .describe("Field to order results by"),
      sort: v.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
      limit: v.number().min(1).max(100).default(20).describe(
        "Maximum number of results to return",
      ),
    })
  )(),
  async execute({ search, membership, orderBy, sort, limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createGitLabClient(userId);
    const projects = await client.listProjects({
      search,
      membership,
      orderBy: requireAllowedValue(
        orderBy,
        ["id", "name", "created_at", "updated_at", "last_activity_at"],
        "project order",
      ),
      sort: requireAllowedValue(sort, ["asc", "desc"], "sort direction"),
      perPage: limit,
    });

    const mappedProjects = projects.map((project) => ({
      id: project.id,
      name: project.name,
      nameWithNamespace: project.name_with_namespace,
      path: project.path_with_namespace,
      description: project.description ?? "No description",
      visibility: project.visibility,
      defaultBranch: project.default_branch,
      webUrl: project.web_url,
      createdAt: project.created_at,
      lastActivityAt: project.last_activity_at,
    }));

    if (!mappedProjects.length) {
      return {
        message: "No projects found matching the criteria.",
        count: 0,
        projects: [],
      };
    }

    return {
      count: mappedProjects.length,
      projects: mappedProjects,
    };
  },
});
