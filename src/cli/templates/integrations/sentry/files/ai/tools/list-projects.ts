import { tool } from "veryfront/ai";
import { z } from "zod";
import { listProjects } from "../../lib/sentry-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List all projects in your Sentry organization. Returns project details including name, platform, status, and team information.",
  inputSchema: z.object({}),
  async execute() {
    const projects = await listProjects();

    return projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      platform: project.platform,
      status: project.status,
      dateCreated: project.dateCreated,
      firstEvent: project.firstEvent,
      isBookmarked: project.isBookmarked,
      isMember: project.isMember,
      hasAccess: project.hasAccess,
      teams: project.teams.map((team) => ({
        id: team.id,
        name: team.name,
        slug: team.slug,
      })),
      features: project.features,
    }));
  },
});
