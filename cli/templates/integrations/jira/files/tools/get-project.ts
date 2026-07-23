import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "get-project",
  description: "Get detailed information about a Jira project by key or ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectIdOrKey: v.string().describe('Project key or ID (e.g., "PROJ")'),
    })
  )(),
  async execute({ projectIdOrKey }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const project = await client.getProject(projectIdOrKey);

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
