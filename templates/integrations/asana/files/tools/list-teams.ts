import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listTeams } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-list-teams",
  description: "List teams in an Asana workspace.",
  inputSchema: defineSchema((v) => v.object({
    workspaceGid: v.string().describe("Asana workspace GID"),
  }))(),
  async execute({ workspaceGid }, context) {
    const userId = requireUserIdFromContext(context);
    const teams = await listTeams(userId, workspaceGid);
    return teams.map(({ gid, name, description }) => ({ gid, name, description }));
  },
});
