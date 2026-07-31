import type { WorkflowRun, WorkflowStatus } from "veryfront/workflow";

type DemoNodeStatus = WorkflowRun["nodeStates"][string]["status"];

export interface DemoWorkflowStep {
  nodeId: string;
  status: DemoNodeStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
}

export interface DemoWorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  input: { topic: string };
  output?: unknown;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  currentNodes: string[];
  nodeStates: Record<string, DemoWorkflowStep>;
  context: Record<string, unknown> & { input: { topic: string } };
  checkpoints: [];
  pendingApprovals: [];
  sourceIntegrationPolicy: { schemaVersion: 1; mode: "unrestricted" };
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
  const timestamp = new Date().toISOString();
  const input = { topic };
  return {
    id,
    workflowId,
    status: "completed",
    input,
    output: { published: true },
    createdAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    currentNodes: [],
    nodeStates: {
      research: {
        nodeId: "research",
        status: "completed",
        attempt: 1,
        startedAt: timestamp,
        completedAt: timestamp,
        output: "Found key points and source material.",
      },
      "write-article": {
        nodeId: "write-article",
        status: "completed",
        attempt: 1,
        startedAt: timestamp,
        completedAt: timestamp,
        output: "Drafted a concise article from the research notes.",
      },
      "editorial-review": {
        nodeId: "editorial-review",
        status: "completed",
        attempt: 1,
        startedAt: timestamp,
        completedAt: timestamp,
      },
      publish: {
        nodeId: "publish",
        status: "completed",
        attempt: 1,
        startedAt: timestamp,
        completedAt: timestamp,
        output: { published: true },
      },
    },
    context: {
      input,
      research: "Found key points and source material.",
      "write-article": "Drafted a concise article from the research notes.",
      publish: { published: true },
    },
    checkpoints: [],
    pendingApprovals: [],
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
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
