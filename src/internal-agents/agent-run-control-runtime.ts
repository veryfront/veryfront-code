import { AgentRunControlRouter } from "./run-control.ts";
import { agentRunSessionManager } from "./session-manager.ts";
import { agentRunWorkerCoordinator } from "./agent-run-worker-coordinator.ts";

export const agentRunControl = new AgentRunControlRouter(
  agentRunWorkerCoordinator,
  agentRunSessionManager,
);
