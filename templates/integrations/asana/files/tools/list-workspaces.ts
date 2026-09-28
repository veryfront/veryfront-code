import { tool } from "veryfront/tool";
import { listWorkspaces } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-list-workspaces",
  description: "List Asana workspaces accessible to the authenticated user.",
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const workspaces = await listWorkspaces(userId);
    return workspaces.map(({ gid, name }) => ({ gid, name }));
  },
});
