import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createJiraClient } from "../lib/jira-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "jira-get-transitions",
  description: "List available workflow transitions for a Jira issue.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueKey: v.string().describe('The issue key (e.g., "PROJ-123") or ID'),
    })
  )(),
  async execute({ issueKey }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createJiraClient(userId);
    const transitions = await client.getIssueTransitions(issueKey);

    return {
      issueKey,
      transitions: transitions.map((transition) => ({
        id: transition.id,
        name: transition.name,
        to: transition.to.name,
      })),
    };
  },
});
