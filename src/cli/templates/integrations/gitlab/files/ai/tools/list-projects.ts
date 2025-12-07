import { tool } from "veryfront/ai";
import { z } from "zod";
import { listProjects } from "../../lib/gitlab-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List GitLab projects accessible to the authenticated user. Can search, filter by membership, and sort results.",
  inputSchema: z.object({
    search: z.string().optional().describe("Search query to filter projects by name or path"),
    membership: z.boolean().default(true).describe("Only show projects where user is a member"),
    orderBy: z.enum(["id", "name", "created_at", "updated_at", "last_activity_at"]).default(
      "last_activity_at",
    ).describe("Field to order results by"),
    sort: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return"),
  }),
  async execute({ search, membership, orderBy, sort, limit }) {
    const projects = await listProjects({
      search,
      membership,
      orderBy,
      sort,
      perPage: limit,
    });

    if (projects.length === 0) {
      return {
        message: "No projects found matching the criteria.",
        count: 0,
        projects: [],
      };
    }

    return {
      count: projects.length,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        nameWithNamespace: project.name_with_namespace,
        path: project.path_with_namespace,
        description: project.description || "No description",
        visibility: project.visibility,
        defaultBranch: project.default_branch,
        webUrl: project.web_url,
        createdAt: project.created_at,
        lastActivityAt: project.last_activity_at,
      })),
    };
  },
});
