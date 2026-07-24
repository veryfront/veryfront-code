import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "jira-list-projects",
  description:
    "List all accessible Jira projects in the connected site. Returns project keys, names, and basic information.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const projects = await client.listProjects();

    return {
      total: projects.length,
      projects: projects.map((project) => {
        const lead = project.lead
          ? {
            displayName: project.lead.displayName,
            accountId: project.lead.accountId,
          }
          : null;

        return {
          key: project.key,
          id: project.id,
          name: project.name,
          projectType: project.projectTypeKey,
          lead,
          avatarUrl: project.avatarUrls?.["48x48"],
        };
      }),
    };
  },
});
