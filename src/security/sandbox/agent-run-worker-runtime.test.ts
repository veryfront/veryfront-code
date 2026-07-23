import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  AgentRunExecutionBundle,
  AgentRunWorkerControlCommand,
  AgentRunWorkerEvent,
} from "./agent-run-worker-contract.ts";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function bundle(
  mode: "backpressure" | "waiting" | "environment" | "sandbox-token",
): AgentRunExecutionBundle {
  return {
    schemaVersion: 1,
    preparationId: crypto.randomUUID(),
    run: {
      runId: `run_${mode}`,
      agentId: "assistant-1",
      projectId: "10000000-1000-4000-8000-100000000005",
      projectSlug: "demo-project",
      runtimeTarget: { runtimeTargetKind: "main_branch" },
    },
    request: {
      runId: `run_${mode}`,
      threadId: "10000000-1000-4000-8000-100000000001",
      agentId: "assistant-1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: { testMode: mode },
      agentSource: { type: "branch", branch: "main" },
    },
    sourceSnapshot: {
      algorithm: "sha256",
      digest: EMPTY_SHA256,
      files: [],
    },
    discovery: {
      agentDirs: ["agents"],
      toolDirs: ["tools"],
      skillDirs: ["skills"],
      modules: [],
    },
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    ...(mode === "environment" ? { projectEnv: { PROJECT_SECRET: "exact-project" } } : {}),
    framework: {
      apiUrl: "https://api.example.com",
      projectId: "10000000-1000-4000-8000-100000000005",
      ...(mode === "sandbox-token" ? { authToken: "request-scoped-token" } : {}),
    },
  };
}

type RuntimeWorker = {
  worker: Worker;
  events: AgentRunWorkerEvent[];
  send(message: unknown): void;
  waitFor<T extends AgentRunWorkerEvent>(
    predicate: (event: AgentRunWorkerEvent) => event is T,
  ): Promise<T>;
  close(): void;
};

function createRuntimeWorker(): RuntimeWorker {
  const runtimeUrl = import.meta.resolve("./agent-run-worker-runtime.ts");
  const schemaUrl = import.meta.resolve("#veryfront/internal-agents/schema.ts");
  const skillExecutorUrl = import.meta.resolve("#veryfront/skill/executor.ts");
  const workerSource = `
    import { AgentRunWorkerRuntime } from ${JSON.stringify(runtimeUrl)};
    import { toRuntimeRunAgentInput } from ${JSON.stringify(schemaUrl)};
    import { getIsolatedSkillScriptExecutor } from ${JSON.stringify(skillExecutorUrl)};
    let discoveryProjectValue;
    const runtime = new AgentRunWorkerRuntime({
      discover: async () => {
        discoveryProjectValue = Deno.env.get("PROJECT_SECRET");
        return {
          tools: new Map(), agents: new Map(), skills: new Map(), resources: new Map(),
          prompts: new Map(), workflows: new Map(), tasks: new Map(), schedules: new Map(),
          webhooks: new Map(), evals: new Map(), errors: [],
        };
      },
      getAgent: () => ({ id: "assistant-1", config: { id: "assistant-1" }, generate() {} }),
      getLocalTools: () => undefined,
      createRuntimeInput: (bundle) => toRuntimeRunAgentInput(bundle.request),
      createRuntimeResponse: async (input, _agent, deps) => {
        deps.sessionManager.startRun({ runId: input.runId, threadId: input.threadId });
        const mode = input.forwardedProps?.testMode;
        if (mode === "backpressure") {
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(200_000).fill(7));
              deps.sessionManager.completeRun(input.runId);
              controller.close();
            },
          }));
        }
        if (mode === "environment") {
          return new Response(new ReadableStream({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode(
                  discoveryProjectValue + ":" + Deno.env.get("PROJECT_SECRET")
                ));
                deps.sessionManager.completeRun(input.runId);
                controller.close();
              }, 0);
            },
          }));
        }
        if (mode === "sandbox-token") {
          const token = deps.projectAgentSandbox?.authToken;
          const executor = getIsolatedSkillScriptExecutor(token);
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(
                token + ":" + executor.constructor.name
              ));
              deps.sessionManager.completeRun(input.runId);
              controller.close();
            },
          }));
        }
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("waiting"));
            deps.sessionManager.prepareForToolResult(input.runId, "tool_1");
            void deps.sessionManager.waitForToolResult(input.runId, "tool_1").then(() => {
              try { controller.enqueue(new TextEncoder().encode("resumed")); } catch {}
              deps.sessionManager.completeRun(input.runId);
              try { controller.close(); } catch {}
            }, () => {
              try { controller.close(); } catch {}
            });
          },
        }));
      },
    });
    const emit = (event, transfer = []) => self.postMessage(event, { transfer });
    self.onmessage = (event) => {
      if (event.data.type === "execute-agent-run") {
        void runtime.execute(event.data, emit);
      } else {
        runtime.handleControl(event.data, emit);
      }
    };
  `;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });
  const events: AgentRunWorkerEvent[] = [];
  const waiters = new Set<{
    predicate: (event: AgentRunWorkerEvent) => boolean;
    resolve: (event: AgentRunWorkerEvent) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  worker.onmessage = (event) => {
    const value = event.data as AgentRunWorkerEvent;
    events.push(value);
    for (const waiter of waiters) {
      if (!waiter.predicate(value)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(event.error ?? new Error(event.message));
    }
    waiters.clear();
  };
  return {
    worker,
    events,
    send: (message) => worker.postMessage(message),
    waitFor(predicate) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing as never);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: resolve as (event: AgentRunWorkerEvent) => void,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error("Timed out waiting for agent Worker event"));
          }, 5_000),
        };
        waiters.add(waiter);
      });
    },
    close() {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      for (const waiter of waiters) clearTimeout(waiter.timer);
      waiters.clear();
    },
  };
}

type ControlWithoutId = AgentRunWorkerControlCommand extends infer Command
  ? Command extends AgentRunWorkerControlCommand ? Omit<Command, "commandId"> : never
  : never;

function control(value: ControlWithoutId): AgentRunWorkerControlCommand {
  return { ...value, commandId: crypto.randomUUID() } as AgentRunWorkerControlCommand;
}

describe("security/sandbox/agent-run-worker-runtime", () => {
  it("does not emit beyond byte credit and splits output into bounded frames", async () => {
    const runtime = createRuntimeWorker();
    try {
      const executionBundle = bundle("backpressure");
      runtime.send({
        type: "execute-agent-run",
        id: "request_backpressure",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-chunk";
      }> => event.type === "agent-stream-chunk");
      await new Promise((resolve) => setTimeout(resolve, 25));
      const initialChunks = runtime.events.filter((event) => event.type === "agent-stream-chunk");
      assertEquals(initialChunks.reduce((sum, event) => sum + event.chunk.byteLength, 0), 1_024);

      runtime.send(control({
        type: "agent-stream-credit",
        runId: executionBundle.run.runId,
        bytes: 200_000,
      }));
      const end = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-end";
      }> => event.type === "agent-stream-end");
      const chunks = runtime.events.filter((event) => event.type === "agent-stream-chunk");
      assertEquals(chunks.reduce((sum, event) => sum + event.chunk.byteLength, 0), 200_000);
      assertEquals(chunks.every((event) => event.chunk.byteLength <= 64 * 1_024), true);
      assertEquals(end.status, "completed");
    } finally {
      runtime.close();
    }
  });

  it("detaches a waiting stream, accepts resume out of band, and completes", async () => {
    const runtime = createRuntimeWorker();
    try {
      const executionBundle = bundle("waiting");
      runtime.send({
        type: "execute-agent-run",
        id: "request_waiting",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-chunk";
      }> => event.type === "agent-stream-chunk");

      const detach = control({
        type: "agent-run-detach",
        runId: executionBundle.run.runId,
      });
      runtime.send(detach);
      const detached = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-run-control-result";
      }> => event.type === "agent-run-control-result" && event.commandId === detach.commandId);
      assertEquals(detached.ok && detached.accepted, true);

      const resume = control({
        type: "agent-run-resume",
        runId: executionBundle.run.runId,
        toolCallId: "tool_1",
        result: { ok: true },
        isError: false,
      });
      runtime.send(resume);
      const resumed = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-run-control-result";
      }> => event.type === "agent-run-control-result" && event.commandId === resume.commandId);
      assertEquals(resumed.ok && resumed.accepted, true);

      const end = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-end";
      }> => event.type === "agent-stream-end");
      assertEquals(end.status, "completed");
      assertEquals(
        runtime.events.filter((event) => event.type === "agent-stream-chunk").length,
        1,
      );
    } finally {
      runtime.close();
    }
  });

  it("cancels a waiting run and emits a cancelled terminal event", async () => {
    const runtime = createRuntimeWorker();
    try {
      const executionBundle = bundle("waiting");
      runtime.send({
        type: "execute-agent-run",
        id: "request_cancel",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-chunk";
      }> => event.type === "agent-stream-chunk");

      const cancel = control({
        type: "agent-run-cancel",
        runId: executionBundle.run.runId,
      });
      runtime.send(cancel);
      const cancelled = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-run-control-result";
      }> => event.type === "agent-run-control-result" && event.commandId === cancel.commandId);
      assertEquals(cancelled.ok && cancelled.accepted, true);

      const end = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-end";
      }> => event.type === "agent-stream-end");
      assertEquals(end.status, "cancelled");
    } finally {
      runtime.close();
    }
  });

  it("rejects a second execution request without disrupting the accepted run", async () => {
    const runtime = createRuntimeWorker();
    try {
      const executionBundle = bundle("waiting");
      runtime.send({
        type: "execute-agent-run",
        id: "request_primary",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-started";
      }> => event.type === "agent-stream-started" && event.id === "request_primary");

      runtime.send({
        type: "execute-agent-run",
        id: "request_duplicate",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      const rejected = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-error";
      }> => event.type === "agent-stream-error" && event.id === "request_duplicate");
      assertEquals(rejected.errorCode, "INVALID_EXECUTION_BUNDLE");

      const cancel = control({
        type: "agent-run-cancel",
        runId: executionBundle.run.runId,
      });
      runtime.send(cancel);
      await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-end";
      }> => event.type === "agent-stream-end" && event.id === "request_primary");
    } finally {
      runtime.close();
    }
  });

  it("keeps the exact project environment active through discovery and asynchronous streaming", async () => {
    const runtime = createRuntimeWorker();
    try {
      const executionBundle = bundle("environment");
      runtime.send({
        type: "execute-agent-run",
        id: "request_environment",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      const end = await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-end";
      }> => event.type === "agent-stream-end");
      assertEquals(end.status, "completed");
      const output = runtime.events
        .filter((event) => event.type === "agent-stream-chunk")
        .map((event) => new TextDecoder().decode(event.chunk))
        .join("");
      assertEquals(output, "exact-project:exact-project");
    } finally {
      runtime.close();
    }
  });

  it("selects adapter-backed skill isolation with only the signed request token", async () => {
    const runtime = createRuntimeWorker();
    try {
      const executionBundle = bundle("sandbox-token");
      runtime.send({
        type: "execute-agent-run",
        id: "request_sandbox_token",
        bundle: executionBundle,
        initialCreditBytes: 1_024,
      });
      await runtime.waitFor((event): event is Extract<AgentRunWorkerEvent, {
        type: "agent-stream-end";
      }> => event.type === "agent-stream-end");
      const output = runtime.events
        .filter((event) => event.type === "agent-stream-chunk")
        .map((event) => new TextDecoder().decode(event.chunk))
        .join("");
      assertEquals(output, "request-scoped-token:CloudScriptExecutor");
    } finally {
      runtime.close();
    }
  });
});
