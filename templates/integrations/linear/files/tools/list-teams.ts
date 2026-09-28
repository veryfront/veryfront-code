import { tool } from "veryfront/tool";
import { getTeams } from "../lib/linear-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "linear-list-teams",
  description:
    "List teams in the Linear workspace. Use this to find the team ID required when creating issues.",
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const teams = await getTeams(userId);

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
    }));
  },
});
