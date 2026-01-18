import { tool } from "veryfront/tool";
import { z } from "zod";
import { listProjects } from "../../lib/jira-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List all accessible Jira projects in the connected site. Returns project keys, names, and basic information.",
  inputSchema: z.object({}),
  async execute() {
    const projects = await listProjects();

    return {
      total: projects.length,
      projects: projects.map((project) => ({
        key: project.key,
        id: project.id,
        name: project.name,
        projectType: project.projectTypeKey,
        lead: project.lead
          ? {
            displayName: project.lead.displayName,
            accountId: project.lead.accountId,
          }
          : null,
        avatarUrl: project.avatarUrls?.["48x48"],
      })),
    };
  },
});
