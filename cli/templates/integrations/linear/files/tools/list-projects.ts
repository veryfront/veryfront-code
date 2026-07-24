import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createLinearClient } from "../lib/linear-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "linear-list-projects",
  description:
    "List all projects in the Linear workspace. Returns project details including name, state, progress, and associated teams.",
  inputSchema: defineSchema((v) =>
    v.object({
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of projects to return"),
      includeArchived: v
        .boolean()
        .default(false)
        .describe("Whether to include archived projects in results"),
    })
  )(),
  async execute({ limit, includeArchived }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createLinearClient(userId);
    const projects = await client.listProjects({ limit, includeArchived });

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      state: project.state,
      progress: Math.round(project.progress * 100),
      url: project.url,
      lead: project.lead
        ? { id: project.lead.id, name: project.lead.name }
        : null,
      teams: project.teams.nodes.map((team) => ({
        id: team.id,
        name: team.name,
        key: team.key,
      })),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  },
});
