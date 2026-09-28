import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listWorkspaces } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-list-workspaces",
  description: "List Asana workspaces accessible to the authenticated user.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const workspaces = await listWorkspaces(userId);
    return workspaces.map(({ gid, name }) => ({ gid, name }));
  },
});
