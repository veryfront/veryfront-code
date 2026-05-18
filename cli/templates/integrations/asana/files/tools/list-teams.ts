import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listTeams } from "../../lib/asana-client.ts";

export default tool({
  id: "list-teams",
  description: "List teams in an Asana workspace.",
  inputSchema: defineSchema((v) => v.object({
    workspaceGid: v.string().describe("Asana workspace GID"),
  }))(),
  async execute({ workspaceGid }) {
    const teams = await listTeams(workspaceGid);
    return teams.map(({ gid, name, description }) => ({ gid, name, description }));
  },
});
