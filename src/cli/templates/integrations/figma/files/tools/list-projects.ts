import { tool } from "veryfront/tool";
import { z } from "zod";
import { getProjectFiles, getTeamProjects } from "../../lib/figma-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List all projects in a Figma team. Optionally include file counts and recent files for each project.",
  inputSchema: z.object({
    teamId: z.string().describe("The team ID to list projects from"),
    includeFiles: z.boolean().default(false).describe("Include recent files for each project"),
    filesPerProject: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of recent files to include per project (if includeFiles is true)"),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of projects to return"),
  }),
  async execute({ teamId, includeFiles, filesPerProject, limit }) {
    const { projects: allProjects } = await getTeamProjects(teamId);
    const projects = allProjects.slice(0, limit);

    if (!includeFiles) {
      return {
        projects: projects.map(({ id, name }) => ({ id, name })),
      };
    }

    const projectsWithFiles = await Promise.all(
      projects.map(async ({ id, name }) => {
        try {
          const { files } = await getProjectFiles(id);
          const recentFiles = files.slice(0, filesPerProject).map((file) => ({
            key: file.key,
            name: file.name,
            thumbnailUrl: file.thumbnail_url,
            lastModified: file.last_modified,
            url: `https://www.figma.com/file/${file.key}`,
          }));

          return {
            id,
            name,
            fileCount: files.length,
            recentFiles,
          };
        } catch (error) {
          return {
            id,
            name,
            fileCount: 0,
            recentFiles: [],
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }),
    );

    return {
      projects: projectsWithFiles,
      totalProjects: projects.length,
    };
  },
});
