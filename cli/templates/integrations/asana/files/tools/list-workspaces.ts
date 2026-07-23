import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-workspaces",
  description: "List Asana workspaces accessible to the authenticated user.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const workspaces = await client.listWorkspaces();
    return workspaces.map(({ gid, name }) => ({ gid, name }));
  },
});
