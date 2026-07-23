import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-teams",
  description: "List teams in an Asana workspace.",
  inputSchema: defineSchema((v) =>
    v.object({
      workspaceGid: v.string().describe("Asana workspace GID"),
    })
  )(),
  async execute({ workspaceGid }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const teams = await client.listTeams(workspaceGid);
    return teams.map(({ gid, name, description }) => ({
      gid,
      name,
      description,
    }));
  },
});
