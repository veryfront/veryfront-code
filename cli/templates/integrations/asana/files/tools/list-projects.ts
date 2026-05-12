import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listProjects, listWorkspaces } from "../../lib/asana-client.ts";

export default tool({
  id: "list-projects",
  description: "List all projects in the Asana workspace.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of projects to return"),
  }))(),
  async execute({ limit }) {
    const [workspace] = await listWorkspaces();

    if (!workspace) {
      return { projects: [], message: "No workspaces found" };
    }

    const projects = await listProjects(workspace.gid);

    return projects.slice(0, limit).map(({ gid, name, notes, created_at }) => ({
      gid,
      name,
      notes,
      createdAt: created_at,
    }));
  },
});
