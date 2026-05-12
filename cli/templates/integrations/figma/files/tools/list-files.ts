import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getProjectFiles, getTeamProjects } from "../../lib/figma-client.ts";

export default tool({
  id: "list-files",
  description:
    "List Figma files in a team project. Returns file names, keys, thumbnails, and last modified dates.",
  inputSchema: defineSchema((v) => v.object({
    teamId: v.string().describe("The team ID to list projects from"),
    projectId: v
      .string()
      .optional()
      .describe("Optional project ID to filter files. If not provided, lists all projects"),
    limit: v.number().min(1).max(50).default(20).describe("Maximum number of files to return"),
  }))(),
  async execute({ teamId, projectId, limit }) {
    if (projectId) {
      const { files } = await getProjectFiles(projectId);
      return files.slice(0, limit).map((file) => ({
        key: file.key,
        name: file.name,
        thumbnailUrl: file.thumbnail_url,
        lastModified: file.last_modified,
        url: `https://www.figma.com/file/${file.key}`,
      }));
    }

    const { projects } = await getTeamProjects(teamId);
    return {
      projects: projects.slice(0, limit).map((project) => ({
        id: project.id,
        name: project.name,
      })),
      message: "Use project IDs to get files with the projectId parameter",
    };
  },
});
