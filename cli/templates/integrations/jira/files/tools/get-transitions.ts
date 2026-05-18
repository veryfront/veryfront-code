import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getIssueTransitions } from "../../lib/jira-client.ts";

export default tool({
  id: "get-transitions",
  description: "List available workflow transitions for a Jira issue.",
  inputSchema: defineSchema((v) =>
    v.object({
      issueKey: v.string().describe('The issue key (e.g., "PROJ-123") or ID'),
    })
  )(),
  async execute({ issueKey }) {
    const transitions = await getIssueTransitions(issueKey);

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
