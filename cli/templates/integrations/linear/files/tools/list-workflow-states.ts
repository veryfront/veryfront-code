import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getWorkflowStates } from "../../lib/linear-client.ts";

export default tool({
  id: "list-workflow-states",
  description:
    "List workflow states for a Linear team. Use this to find a state ID before updating an issue status.",
  inputSchema: defineSchema((v) => v.object({
    teamId: v.string().describe("Linear team ID"),
  }))(),
  async execute({ teamId }) {
    const states = await getWorkflowStates(teamId);

    return states.map((state) => ({
      id: state.id,
      name: state.name,
      type: state.type,
    }));
  },
});
