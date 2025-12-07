import { tool } from "veryfront/ai";
import { z } from "zod";
import { listProjects, listWorkspaces } from "../../lib/asana-client.ts";

export default tool({
  id: "list-projects",
  description: "List all projects in the Asana workspace.",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of projects to return"),
  }),
  async execute({ limit }) {
    const workspaces = await listWorkspaces();
    if (workspaces.length === 0) {
      return { projects: [], message: "No workspaces found" };
    }

    const projects = await listProjects(workspaces[0].gid);

    return projects.slice(0, limit).map((project) => ({
      gid: project.gid,
      name: project.name,
      notes: project.notes,
      createdAt: project.created_at,
    }));
  },
});
