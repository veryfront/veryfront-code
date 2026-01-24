import { tool } from "veryfront/tool";
import { z } from "zod";
import { listProjects } from "../../lib/sentry-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List all projects in your Sentry organization. Returns project details including name, platform, status, and team information.",
  inputSchema: z.object({}),
  async execute() {
    const projects = await listProjects();

    return projects.map(
      ({
        id,
        slug,
        name,
        platform,
        status,
        dateCreated,
        firstEvent,
        isBookmarked,
        isMember,
        hasAccess,
        teams,
        features,
      }) => ({
        id,
        slug,
        name,
        platform,
        status,
        dateCreated,
        firstEvent,
        isBookmarked,
        isMember,
        hasAccess,
        teams: teams.map(({ id, name, slug }) => ({ id, name, slug })),
        features,
      }),
    );
  },
});
