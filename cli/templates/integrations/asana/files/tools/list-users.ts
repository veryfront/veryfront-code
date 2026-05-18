import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listUsers } from "../../lib/asana-client.ts";

export default tool({
  id: "list-users",
  description: "List users in an Asana workspace.",
  inputSchema: defineSchema((v) => v.object({
    workspaceGid: v.string().describe("Asana workspace GID"),
    teamGid: v.string().optional().describe("Optional Asana team GID"),
  }))(),
  async execute({ workspaceGid, teamGid }) {
    const users = await listUsers({ workspaceGid, teamGid });
    return users.map(({ gid, name, email }) => ({ gid, name, email }));
  },
});
