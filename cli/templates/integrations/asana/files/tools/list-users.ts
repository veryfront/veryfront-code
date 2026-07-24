import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-list-users",
  description: "List users in an Asana workspace.",
  inputSchema: defineSchema((v) =>
    v.object({
      workspaceGid: v.string().describe("Asana workspace GID"),
      teamGid: v.string().optional().describe("Optional Asana team GID"),
    })
  )(),
  async execute({ workspaceGid, teamGid }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const users = await client.listUsers({ workspaceGid, teamGid });
    return users.map(({ gid, name, email }) => ({ gid, name, email }));
  },
});
