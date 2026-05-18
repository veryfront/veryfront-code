import { tool } from "veryfront/tool";
import { listWorkspaces } from "../../lib/asana-client.ts";

export default tool({
  id: "list-workspaces",
  description: "List Asana workspaces accessible to the authenticated user.",
  async execute() {
    const workspaces = await listWorkspaces();
    return workspaces.map(({ gid, name }) => ({ gid, name }));
  },
});
