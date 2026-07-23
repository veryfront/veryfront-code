import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgentRunWorkerCoordinator,
  type AgentRunWorkerTransport,
} from "#veryfront/internal-agents/agent-run-worker-coordinator.ts";
import { AgentRunAlreadyExistsError } from "#veryfront/internal-agents/session-manager.ts";
import type {
  AgentRunExecutionBundle,
  AgentRunWorkerControlCommand,
  AgentRunWorkerControlResult,
} from "#veryfront/security/sandbox/agent-run-worker-contract.ts";
import {
  executeIsolatedAgentStream,
  type IsolatedAgentRunClient,
  type ParsedAgentStreamPayload,
} from "./agent-stream-isolated-execution.ts";
import { createSourceCapableAgentStreamContext } from "./agent-stream-test-fixtures.ts";

const PROJECT_ID = "10000000-1000-4000-8000-100000000005";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function parsed(runId = "run_1"): ParsedAgentStreamPayload {
  return {
    payload: {
      runId,
      threadId: "10000000-1000-4000-8000-100000000001",
      agentId: "assistant-1",
      messages: [],
      tools: [],
      context: [],
      agentSource: { type: "branch", branch: "main" },
    },
    project: { projectId: PROJECT_ID, projectSlug: "demo-project" },
    runtimeTarget: {
      runtimeTargetKind: "preview_branch",
      runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
    },
  };
}

function bundle(input: ParsedAgentStreamPayload): AgentRunExecutionBundle {
  return {
    schemaVersion: 1,
    preparationId: crypto.randomUUID(),
    run: {
      runId: input.payload.runId,
      agentId: input.payload.agentId,
      projectId: input.project.projectId,
      projectSlug: input.project.projectSlug,
      runtimeTarget: input.runtimeTarget,
    },
    request: input.payload,
    sourceSnapshot: { algorithm: "sha256", digest: EMPTY_SHA256, files: [] },
    discovery: { agentDirs: ["agents"], toolDirs: ["tools"], skillDirs: ["skills"], modules: [] },
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    projectEnv: { PROJECT_VALUE: "exact-source" },
    framework: { apiUrl: "https://api.example.com", projectId: PROJECT_ID },
  };
}

class RecordingClient implements IsolatedAgentRunClient {
  readonly terminations: string[] = [];
  startCalls = 0;

  constructor(private readonly startResult: () => Promise<Response>) {}

  start(): Promise<Response> {
    this.startCalls++;
    return this.startResult();
  }

  requestControl(_command: AgentRunWorkerControlCommand): Promise<AgentRunWorkerControlResult> {
    return Promise.reject(new Error("Control is not expected in this test"));
  }

  terminate(reason: string): void {
    this.terminations.push(reason);
  }
}

const inertTransport: AgentRunWorkerTransport = {
  requestControl: () => Promise.reject(new Error("Control is not expected in this test")),
  terminate: () => {},
};

describe("server/handlers/request/agent-stream-isolated-execution", () => {
  it("builds the exact-source bundle, registers ownership, and starts only the Worker client", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const client = new RecordingClient(() => Promise.resolve(new Response("stream")));
    const invocation = parsed();
    let bundleInput:
      | {
        projectEnv?: Record<string, string>;
        run: { runId: string };
        framework: { authToken?: string };
      }
      | undefined;
    try {
      const response = await executeIsolatedAgentStream({
        req: new Request("https://runtime.example.com/api/control-plane/runs/run_1/stream"),
        ctx: createSourceCapableAgentStreamContext(),
        parsed: invocation,
        apiAuthToken: "request-token",
        deps: {
          coordinator,
          resolveRuntimeOwnerInvokeUrl: () =>
            Promise.resolve("http://10.0.0.7:20000/channels/invoke"),
          buildProjectEnvironment: () => Promise.resolve({ PROJECT_VALUE: "exact-source" }),
          buildBundle: (input) => {
            bundleInput = input;
            return Promise.resolve(bundle(invocation));
          },
          createWorkerClient: () => client,
        },
      });

      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("x-veryfront-runtime-owner-invoke-url"),
        "http://10.0.0.7:20000/channels/invoke",
      );
      assertEquals(bundleInput?.projectEnv, { PROJECT_VALUE: "exact-source" });
      assertEquals(bundleInput?.run.runId, "run_1");
      assertEquals(bundleInput?.framework.authToken, "request-token");
      assertEquals(client.startCalls, 1);
      assertEquals(
        coordinator.getRunOwnership("run_1", {
          projectId: PROJECT_ID,
          projectSlug: "demo-project",
        }),
        "owned",
      );
    } finally {
      await coordinator.reset();
    }
  });

  it("terminates an unregistered Worker when duplicate ownership rejects registration", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const invocation = parsed();
    coordinator.registerRun({
      runId: invocation.payload.runId,
      binding: { projectId: PROJECT_ID, projectSlug: "demo-project" },
      transport: inertTransport,
    });
    const client = new RecordingClient(() => Promise.resolve(new Response("unused")));
    try {
      await assertRejects(
        () =>
          executeIsolatedAgentStream({
            req: new Request("https://runtime.example.com/api/control-plane/runs/run_1/stream"),
            ctx: createSourceCapableAgentStreamContext(),
            parsed: invocation,
            apiAuthToken: "request-token",
            deps: {
              coordinator,
              resolveRuntimeOwnerInvokeUrl: () => Promise.resolve(null),
              buildProjectEnvironment: () => Promise.resolve({}),
              buildBundle: () => Promise.resolve(bundle(invocation)),
              createWorkerClient: () => client,
            },
          }),
        AgentRunAlreadyExistsError,
      );
      assertEquals(client.terminations, ["registration-failed"]);
      assertEquals(client.startCalls, 0);
    } finally {
      await coordinator.reset();
    }
  });

  it("releases ownership and terminates the Worker when startup fails", async () => {
    const coordinator = new AgentRunWorkerCoordinator();
    const invocation = parsed("run_start_failure");
    const client = new RecordingClient(() => Promise.reject(new Error("start failed")));
    try {
      await assertRejects(
        () =>
          executeIsolatedAgentStream({
            req: new Request(
              "https://runtime.example.com/api/control-plane/runs/run_start_failure/stream",
            ),
            ctx: createSourceCapableAgentStreamContext(),
            parsed: invocation,
            apiAuthToken: "request-token",
            deps: {
              coordinator,
              resolveRuntimeOwnerInvokeUrl: () => Promise.resolve(null),
              buildProjectEnvironment: () => Promise.resolve({}),
              buildBundle: () => Promise.resolve(bundle(invocation)),
              createWorkerClient: () => client,
            },
          }),
        Error,
        "start failed",
      );
      assertEquals(client.terminations, ["failed"]);
    } finally {
      await coordinator.reset();
    }
  });
});
