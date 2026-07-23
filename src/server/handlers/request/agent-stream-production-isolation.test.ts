import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { AgentRunWorkerCoordinator } from "#veryfront/internal-agents/agent-run-worker-coordinator.ts";
import type {
  AgentRunExecutionBundle,
  AgentRunWorkerControlCommand,
  AgentRunWorkerControlResult,
} from "#veryfront/security/sandbox/agent-run-worker-contract.ts";
import { AgentStreamHandler } from "./agent-stream.handler.ts";
import type { IsolatedAgentRunClient } from "./agent-stream-isolated-execution.ts";
import {
  AGENT_STREAM_TEST_PROJECT_ID,
  AGENT_STREAM_TEST_PROJECT_SLUG,
  createAgentStreamRequestBody,
  createSourceCapableAgentStreamContext,
} from "./agent-stream-test-fixtures.ts";
import { createControlPlaneSignature } from "./internal-agent-run.test-helpers.ts";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function executionBundle(): AgentRunExecutionBundle {
  return {
    schemaVersion: 1,
    preparationId: crypto.randomUUID(),
    run: {
      runId: "run_1",
      agentId: "assistant-1",
      projectId: AGENT_STREAM_TEST_PROJECT_ID,
      projectSlug: AGENT_STREAM_TEST_PROJECT_SLUG,
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
    discovery: { agentDirs: ["agents"], toolDirs: ["tools"], skillDirs: ["skills"], modules: [] },
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    framework: { apiUrl: "https://api.example.com", projectId: AGENT_STREAM_TEST_PROJECT_ID },
  };
}

describe("server/agent-stream production isolation", () => {
  it("ignores a host API token and invokes only the isolated Worker seam", async () => {
    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      audience: AGENT_STREAM_TEST_PROJECT_SLUG,
      projectId: AGENT_STREAM_TEST_PROJECT_ID,
      requestId: "run_1",
    });
    const coordinator = new AgentRunWorkerCoordinator();
    const terminations: string[] = [];
    const client: IsolatedAgentRunClient = {
      start: () => Promise.resolve(new Response("isolated-stream")),
      requestControl(
        _command: AgentRunWorkerControlCommand,
      ): Promise<AgentRunWorkerControlResult> {
        return Promise.reject(new Error("Control is not expected in this test"));
      },
      terminate: (reason) => {
        terminations.push(reason);
      },
    };
    let selectedToken: string | undefined;
    let bundleBuilds = 0;
    const handler = new AgentStreamHandler({
      coordinator,
      resolveRuntimeOwnerInvokeUrl: () => Promise.resolve(null),
      buildProjectEnvironment: (input) => {
        selectedToken = input.token;
        return Promise.resolve({});
      },
      buildBundle: () => {
        bundleBuilds++;
        return Promise.resolve(executionBundle());
      },
      createWorkerClient: () => client,
    });

    try {
      const result = await withEnv(
        { VERYFRONT_API_TOKEN: "host-secret-must-not-cross" },
        () =>
          handler.handle(
            new Request("https://runtime.example.com/api/control-plane/runs/run_1/stream", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-veryfront-control-plane-jws": jws,
              },
              body,
            }),
            createSourceCapableAgentStreamContext(publicKeyPem),
          ),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(await result.response.text(), "isolated-stream");
      assertEquals(selectedToken, "");
      assertEquals(bundleBuilds, 1);
    } finally {
      await coordinator.reset();
    }
    assertEquals(terminations, ["shutdown"]);
  });
});
