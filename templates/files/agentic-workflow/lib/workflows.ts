import { getAgent, getAllAgentIds } from "veryfront/agent";
import { toolRegistry } from "veryfront/tool";
import { createWorkflowClient } from "veryfront/workflow";
import contentPipeline from "../workflows/content-pipeline.ts";

/**
 * The one workflow client the app starts, reads, and approves runs through.
 *
 * Steps resolve `agents/` and `tools/` by id. Runs live in memory, so they
 * last until the server restarts; pass a `backend` for durable storage.
 */
export const workflows = createWorkflowClient({
  executor: {
    stepExecutor: {
      agentRegistry: { get: getAgent, list: getAllAgentIds },
      toolRegistry,
    },
  },
});

workflows.register(contentPipeline);
