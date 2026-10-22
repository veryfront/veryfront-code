import { createWorkflowHandler } from "veryfront/workflow";
import { workflows } from "../../../../lib/workflows.ts";

// Serves every route the workflow hooks call: start, list, read, and approve.
export const { GET, POST } = createWorkflowHandler(workflows, {
  // Every request acts as one local user. Before deploying, return the signed-in
  // user's id from your session, and null to deny the request.
  authorize: () => "local-user",
});
