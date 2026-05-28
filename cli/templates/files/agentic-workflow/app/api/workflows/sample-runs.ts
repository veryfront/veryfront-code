export interface DemoWorkflowStep {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "waiting_for_approval" | "failed";
  output?: string | Record<string, unknown>;
}

export interface DemoWorkflowRun {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "completed" | "waiting_for_approval" | "failed";
  input: { topic: string };
  createdAt: string;
  currentNodes: string[];
  nodeStates: Record<string, { status: DemoWorkflowStep["status"] }>;
  pendingApprovals: Array<{ id: string; status: "pending" | "approved" | "rejected" }>;
  steps: DemoWorkflowStep[];
}

export function createDemoWorkflowRun(
  id = "test-run",
  topic = "Example content pipeline",
): DemoWorkflowRun {
  return {
    id,
    workflowId: "content-pipeline",
    status: "completed",
    input: { topic },
    createdAt: new Date().toISOString(),
    currentNodes: [],
    nodeStates: {
      research: { status: "completed" },
      "write-article": { status: "completed" },
      "editorial-review": { status: "completed" },
      publish: { status: "completed" },
    },
    pendingApprovals: [],
    steps: [
      {
        id: "research",
        name: "Research",
        status: "completed",
        output: "Found key points and source material.",
      },
      {
        id: "write-article",
        name: "Write article",
        status: "completed",
        output: "Drafted a concise article from the research notes.",
      },
      {
        id: "editorial-review",
        name: "Editorial review",
        status: "completed",
      },
      {
        id: "publish",
        name: "Publish",
        status: "completed",
        output: { published: true },
      },
    ],
  };
}
