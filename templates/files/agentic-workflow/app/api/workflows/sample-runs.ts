/** Node statuses the framework reports; the UI keys its icons off these. */
export type DemoNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface DemoNodeState {
  nodeId: string;
  status: DemoNodeStatus;
  attempt: number;
  output?: string | Record<string, unknown>;
}

export interface DemoWorkflowRun {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "completed" | "waiting_for_approval" | "failed";
  input: { topic: string };
  createdAt: string;
  currentNodes: string[];
  nodeStates: Record<string, DemoNodeState>;
  pendingApprovals: Array<{ id: string; status: "pending" | "approved" | "rejected" }>;
}

const globalStore = globalThis as typeof globalThis & {
  __veryfrontAgenticWorkflowDemoRuns?: Map<string, DemoWorkflowRun>;
};
const demoRuns = globalStore.__veryfrontAgenticWorkflowDemoRuns ??= new Map<
  string,
  DemoWorkflowRun
>();

export function createDemoWorkflowRun(
  id = "test-run",
  topic = "Example content pipeline",
  workflowId = "content-pipeline",
): DemoWorkflowRun {
  return {
    id,
    workflowId,
    status: "completed",
    input: { topic },
    createdAt: new Date().toISOString(),
    currentNodes: [],
    nodeStates: {
      research: {
        nodeId: "research",
        status: "completed",
        attempt: 1,
        output: "Found key points and source material.",
      },
      "write-article": {
        nodeId: "write-article",
        status: "completed",
        attempt: 1,
        output: "Drafted a concise article from the research notes.",
      },
      "editorial-review": {
        nodeId: "editorial-review",
        status: "completed",
        attempt: 1,
      },
      publish: {
        nodeId: "publish",
        status: "completed",
        attempt: 1,
        output: { published: true },
      },
    },
    pendingApprovals: [],
  };
}

export function getDemoWorkflowRun(id: string): DemoWorkflowRun {
  return demoRuns.get(id) ?? createDemoWorkflowRun(id);
}

export function listDemoWorkflowRuns(options: {
  workflowId?: string | null;
  limit?: number;
} = {}): DemoWorkflowRun[] {
  if (!demoRuns.has("test-run")) {
    demoRuns.set("test-run", createDemoWorkflowRun());
  }

  const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
    ? options.limit
    : 20;

  return Array.from(demoRuns.values())
    .filter((run) => !options.workflowId || run.workflowId === options.workflowId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

export function startDemoWorkflowRun(
  workflowId: string,
  input: { topic?: string } = {},
): DemoWorkflowRun {
  const runId = `run-${Date.now()}`;
  const topic = input.topic?.trim() || "Untitled workflow";
  const run = createDemoWorkflowRun(runId, topic, workflowId);

  demoRuns.set(run.id, run);
  return run;
}
