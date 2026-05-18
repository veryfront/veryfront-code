import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getProject } from "../../lib/jira-client.ts";

export default tool({
  id: "get-project",
  description: "Get detailed information about a Jira project by key or ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectIdOrKey: v.string().describe('Project key or ID (e.g., "PROJ")'),
    })
  )(),
  async execute({ projectIdOrKey }) {
    const project = await getProject(projectIdOrKey);

    return {
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
      self: project.self,
    };
  },
});
