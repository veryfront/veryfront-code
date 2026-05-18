import { tool } from "veryfront/tool";
import { getTeams } from "../../lib/linear-client.ts";

export default tool({
  id: "list-teams",
  description:
    "List teams in the Linear workspace. Use this to find the team ID required when creating issues.",
  async execute() {
    const teams = await getTeams();

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
    }));
  },
});
