import { tool } from "veryfront/ai";
import { z } from "zod";
import { getProjectFiles, getTeamProjects } from "../../lib/figma-client.ts";

export default tool({
  id: "list-files",
  description:
    "List Figma files in a team project. Returns file names, keys, thumbnails, and last modified dates.",
  inputSchema: z.object({
    teamId: z.string().describe("The team ID to list projects from"),
    projectId: z.string().optional().describe(
      "Optional project ID to filter files. If not provided, lists all projects",
    ),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of files to return"),
  }),
  async execute({ teamId, projectId, limit }) {
    if (projectId) {
      // List files from a specific project
      const response = await getProjectFiles(projectId);
      return response.files.slice(0, limit).map((file) => ({
        key: file.key,
        name: file.name,
        thumbnailUrl: file.thumbnail_url,
        lastModified: file.last_modified,
        url: `https://www.figma.com/file/${file.key}`,
      }));
    } else {
      // List all projects in the team
      const response = await getTeamProjects(teamId);
      return {
        projects: response.projects.slice(0, limit).map((project) => ({
          id: project.id,
          name: project.name,
        })),
        message: "Use project IDs to get files with the projectId parameter",
      };
    }
  },
});
