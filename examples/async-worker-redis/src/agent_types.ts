export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRun {
  id: string;
  agentId: string;
  input: string;
  status: AgentRunStatus;
  result?: string;
  error?: string;
  state?: string; // JSON-encoded agent state
  createdAt: string;
  updatedAt: string;
}

export function runKey(runId: string) {
  return `agent:run:${runId}`;
}

export const STREAM_KEY = "agent:stream";
export const GROUP_NAME = "agent:group";
