import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createLinearClient } from "../lib/linear-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "linear-list-teams",
  description:
    "List teams in the Linear workspace. Use this to find the team ID required when creating issues.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const client = createLinearClient(userId);
    const teams = await client.getTeams();

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
    }));
  },
});
