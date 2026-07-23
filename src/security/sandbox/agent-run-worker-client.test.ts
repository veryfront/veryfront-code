import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  AgentRunExecutionBundle,
  AgentRunWorkerControlCommand,
  AgentRunWorkerEvent,
} from "./agent-run-worker-contract.ts";
import { AGENT_RUN_WORKER_MAX_FRAME_BYTES } from "./agent-run-worker-contract.ts";
import {
  AgentRunWorkerClient,
  type AgentRunWorkerClientOptions,
} from "./agent-run-worker-client.ts";
import type {
  ProjectWorkerOptions,
  ProjectWorkerProtocolSession,
  ProtocolSessionHandler,
} from "./project-worker.ts";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function bundle(): AgentRunExecutionBundle {
  return {
    schemaVersion: 1,
    preparationId: crypto.randomUUID(),
    run: {
      runId: "run_1",
      agentId: "assistant-1",
      projectId: "10000000-1000-4000-8000-100000000005",
      projectSlug: "demo-project",
      runtimeTarget: { runtimeTargetKind: "main_branch" },
    },
    request: {
      runId: "run_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      agentId: "assistant-1",
      messages: [],
      tools: [],
      context: [],
      agentSource: { type: "branch", branch: "main" },
    },
    sourceSnapshot: { algorithm: "sha256", digest: EMPTY_SHA256, files: [] },
    discovery: {
      agentDirs: ["agents"],
      toolDirs: ["tools"],
      skillDirs: ["skills"],
      modules: [],
    },
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    projectEnv: { PROJECT_SECRET: "exact-project-value" },
    framework: {
      apiUrl: "https://api.example.com",
      projectId: "10000000-1000-4000-8000-100000000005",
    },
  };
}

class FakeProjectWorker {
  readonly sent: unknown[] = [];
  started = false;
  terminated = false;
  handler: ProtocolSessionHandler | null = null;

  start(): void {
    this.started = true;
  }

  openProtocolSession(handler: ProtocolSessionHandler): ProjectWorkerProtocolSession {
    this.handler = handler;
    return {
      postMessage: (message) => this.sent.push(message),
      close: () => {
        this.handler = null;
      },
    };
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: unknown): void {
    this.handler?.onMessage(event);
  }
}

function createClient(
  options: Omit<AgentRunWorkerClientOptions, "createProjectWorker"> = {},
): {
  client: AgentRunWorkerClient;
  worker: FakeProjectWorker;
  workerOptions: ProjectWorkerOptions;
} {
  const worker = new FakeProjectWorker();
  let workerOptions!: ProjectWorkerOptions;
  const client = new AgentRunWorkerClient(bundle(), {
    ...options,
    createProjectWorker: (options) => {
      workerOptions = options;
      return worker;
    },
  });
  return { client, worker, workerOptions };
}

type WorkerEventWithoutIdentity = AgentRunWorkerEvent extends infer Event
  ? Event extends AgentRunWorkerEvent ? Omit<Event, "id" | "runId"> : never
  : never;

function streamEvent(
  requestId: string,
  event: WorkerEventWithoutIdentity,
): AgentRunWorkerEvent {
  return { ...event, id: requestId, runId: "run_1" } as AgentRunWorkerEvent;
}

function executionRequest(worker: FakeProjectWorker) {
  return worker.sent.find((value) => (value as { type?: string }).type === "execute-agent-run") as {
    id: string;
    initialCreditBytes: number;
  };
}

describe("security/sandbox/agent-run-worker-client", () => {
  it("starts a dedicated Worker without project filesystem read permission", () => {
    const { client, worker, workerOptions } = createClient();
    try {
      assertEquals(worker.started, true);
      assertEquals(workerOptions.permissions.read, false);
      assertEquals(
        Array.isArray(workerOptions.permissions.env) &&
          workerOptions.permissions.env.includes("PROJECT_SECRET"),
        true,
      );
      void client.start().catch(() => {});
      assertExists(executionRequest(worker));
    } finally {
      client.terminate();
    }
  });

  it("sends one execution request when start is called repeatedly", () => {
    const { client, worker } = createClient();
    try {
      void client.start().catch(() => {});
      void client.start().catch(() => {});
      assertEquals(
        worker.sent.filter((value) => (value as { type?: unknown }).type === "execute-agent-run")
          .length,
        1,
      );
    } finally {
      client.terminate();
    }
  });

  it("terminates a partially started Worker when private-session setup fails", () => {
    const worker = new FakeProjectWorker();
    worker.openProtocolSession = () => {
      throw new Error("private session failed");
    };

    assertThrows(
      () =>
        new AgentRunWorkerClient(bundle(), {
          createProjectWorker: () => worker,
        }),
      Error,
      "private session failed",
    );
    assertEquals(worker.terminated, true);
  });

  it("fails closed when a Worker exceeds host-issued stream credit", async () => {
    const { client, worker } = createClient();
    const responsePromise = client.start();
    const request = executionRequest(worker);
    worker.emit(streamEvent(request.id, { type: "agent-stream-started" }));
    const response = await responsePromise;
    assertExists(response.body);

    const chunk = new Uint8Array(AGENT_RUN_WORKER_MAX_FRAME_BYTES);
    worker.emit(streamEvent(request.id, { type: "agent-stream-chunk", chunk }));
    worker.emit(streamEvent(request.id, { type: "agent-stream-chunk", chunk }));
    worker.emit(streamEvent(request.id, { type: "agent-stream-chunk", chunk }));

    await assertRejects(() => response.arrayBuffer(), Error, "protocol");
    assertEquals(worker.terminated, true);
  });

  it("rejects accessor and polluted-prototype events without invoking project accessors", async () => {
    for (const kind of ["accessor", "prototype"] as const) {
      const { client, worker } = createClient();
      const responsePromise = client.start();
      const request = executionRequest(worker);
      let accessorCalls = 0;
      const event: Record<string, unknown> = {
        id: request.id,
        runId: "run_1",
      };
      if (kind === "accessor") {
        Object.defineProperty(event, "type", {
          enumerable: true,
          get() {
            accessorCalls++;
            return "agent-stream-started";
          },
        });
      } else {
        event.type = "agent-stream-started";
        Object.setPrototypeOf(event, { polluted: true });
      }

      worker.emit(event);
      await assertRejects(() => responsePromise, Error, "protocol");
      assertEquals(accessorCalls, 0);
      assertEquals(worker.terminated, true);
    }
  });

  it("detaches on client cancellation and terminates after the Worker reaches a terminal state", async () => {
    const terminal: string[] = [];
    const { client, worker } = createClient({
      onTerminal: (status) => {
        terminal.push(status);
      },
    });
    const responsePromise = client.start();
    const request = executionRequest(worker);
    worker.emit(streamEvent(request.id, { type: "agent-stream-started" }));
    const response = await responsePromise;
    assertExists(response.body);

    const cancel = response.body.cancel();
    const detach = worker.sent.find((value) =>
      (value as AgentRunWorkerControlCommand).type === "agent-run-detach"
    ) as Extract<AgentRunWorkerControlCommand, { type: "agent-run-detach" }>;
    assertExists(detach);
    worker.emit({
      type: "agent-run-control-result",
      commandId: detach.commandId,
      runId: detach.runId,
      operation: "detach",
      ok: true,
      accepted: true,
    });
    await cancel;
    worker.emit(streamEvent(request.id, {
      type: "agent-stream-end",
      status: "completed",
    }));
    await Promise.resolve();

    assertEquals(terminal, ["completed"]);
    assertEquals(worker.terminated, true);
  });

  it("terminates a detached run when its bounded lifetime expires", async () => {
    const terminal: string[] = [];
    const { client, worker } = createClient({
      maxLifetimeMs: 5,
      onTerminal: (status) => {
        terminal.push(status);
      },
    });
    const responsePromise = client.start();
    const request = executionRequest(worker);
    worker.emit(streamEvent(request.id, { type: "agent-stream-started" }));
    const response = await responsePromise;
    assertExists(response.body);

    const cancel = response.body.cancel();
    const detach = worker.sent.find((value) =>
      (value as AgentRunWorkerControlCommand).type === "agent-run-detach"
    ) as Extract<AgentRunWorkerControlCommand, { type: "agent-run-detach" }>;
    worker.emit({
      type: "agent-run-control-result",
      commandId: detach.commandId,
      runId: detach.runId,
      operation: "detach",
      ok: true,
      accepted: true,
    });
    await cancel;
    await new Promise((resolve) => setTimeout(resolve, 20));

    assertEquals(terminal, ["failed"]);
    assertEquals(worker.terminated, true);
  });
});
