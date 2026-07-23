import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AGENT_RUN_WORKER_MAX_CREDIT_BYTES,
  AGENT_RUN_WORKER_MAX_MODULE_BYTES,
  type AgentRunExecutionBundle,
  assertValidAgentRunExecutionBundle,
  assertValidAgentRunWorkerControlCommand,
  assertValidAgentRunWorkerControlResult,
  assertValidAgentRunWorkerEvent,
  assertValidAgentRunWorkerPreparationRequest,
  assertValidAgentRunWorkerPreparationResponse,
  createAgentRunSourceBindingKey,
  verifyAgentRunExecutionBundleSource,
} from "./agent-run-worker-contract.ts";

function createBundle(): AgentRunExecutionBundle {
  return {
    schemaVersion: 1,
    preparationId: "10000000-1000-4000-8000-100000000009",
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
      agentConfig: {
        id: "assistant-1",
        name: "Assistant",
        description: "",
        instructions: "Help the user.",
      },
    },
    discovery: {
      agentDirs: ["agents"],
      toolDirs: ["tools"],
      skillDirs: ["skills"],
      modules: [{
        concepts: ["tool"],
        sourcePath: "tools/search.ts",
        moduleCode: "export default {};",
      }],
    },
    sourceSnapshot: {
      algorithm: "sha256",
      digest: "a".repeat(64),
      files: [{
        sourcePath: "skills/research/SKILL.md",
        content: new TextEncoder().encode("# Research"),
      }, {
        sourcePath: "tools/search.ts",
        content: new TextEncoder().encode("export default {};"),
      }],
    },
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    projectEnv: { PROJECT_VALUE: "safe" },
    framework: {
      apiUrl: "https://api.example.com",
      authToken: "test-token",
      projectId: "10000000-1000-4000-8000-100000000005",
    },
  };
}

describe("security/sandbox/agent-run-worker-contract", () => {
  it("accepts a bounded exact-source execution bundle", () => {
    const bundle = createBundle();
    assertValidAgentRunExecutionBundle(bundle);
    assertEquals(
      createAgentRunSourceBindingKey(bundle),
      JSON.stringify({
        projectId: bundle.run.projectId,
        projectSlug: bundle.run.projectSlug,
        agentSource: bundle.request.agentSource,
        runtimeTarget: bundle.run.runtimeTarget,
        sourceDigest: bundle.sourceSnapshot.digest,
      }),
    );
  });

  it("rejects mismatched signed request identities", () => {
    const bundle = createBundle();
    bundle.request.runId = "run_2";
    assertThrows(
      () => assertValidAgentRunExecutionBundle(bundle),
      TypeError,
      "run id",
    );
  });

  it("rejects source paths that escape the snapshot", () => {
    const bundle = createBundle();
    bundle.discovery.modules[0]!.sourcePath = "../tools/search.ts";
    assertThrows(
      () => assertValidAgentRunExecutionBundle(bundle),
      TypeError,
      "project-relative",
    );
  });

  it("rejects module payloads beyond the process-boundary budget", () => {
    const bundle = createBundle();
    bundle.discovery.modules[0]!.moduleCode = "x".repeat(
      AGENT_RUN_WORKER_MAX_MODULE_BYTES + 1,
    );
    assertThrows(
      () => assertValidAgentRunExecutionBundle(bundle),
      RangeError,
      "module",
    );
  });

  it("rejects invalid environment keys and duplicate snapshot paths", () => {
    const bundle = createBundle();
    bundle.projectEnv = { "INVALID-KEY": "value" };
    assertThrows(
      () => assertValidAgentRunExecutionBundle(bundle),
      TypeError,
      "environment",
    );

    const duplicate = createBundle();
    duplicate.sourceSnapshot.files.push({
      sourcePath: "skills/research/SKILL.md",
      content: new Uint8Array(),
    });
    assertThrows(
      () => assertValidAgentRunExecutionBundle(duplicate),
      TypeError,
      "duplicate",
    );
  });

  it("binds Worker-side config preparation to the exact run and source digest", () => {
    const bundle = createBundle();
    const request = {
      type: "prepare-agent-run" as const,
      schemaVersion: 1 as const,
      preparationId: bundle.preparationId,
      sourceDigest: bundle.sourceSnapshot.digest,
    };
    assertValidAgentRunWorkerPreparationRequest(request);
    const response = {
      type: "agent-run-prepared" as const,
      schemaVersion: 1 as const,
      preparationId: request.preparationId,
      sourceDigest: request.sourceDigest,
      projection: {
        agentDirs: ["custom-agents"],
        toolDirs: ["custom-tools"],
        skillDirs: ["custom-skills"],
        sourceIntegrationPolicy: { schemaVersion: 1 as const, mode: "unrestricted" as const },
      },
    };
    assertValidAgentRunWorkerPreparationResponse(response, request);

    response.sourceDigest = "b".repeat(64);
    assertThrows(
      () => assertValidAgentRunWorkerPreparationResponse(response, request),
      TypeError,
      "identity",
    );
  });

  it("rejects a source digest that does not match the transferred bytes", async () => {
    await assertRejects(
      () => verifyAgentRunExecutionBundleSource(createBundle()),
      TypeError,
      "digest",
    );
  });

  it("bounds credit commands before they enter a Worker", () => {
    assertValidAgentRunWorkerControlCommand({
      type: "agent-stream-credit",
      commandId: crypto.randomUUID(),
      runId: "run_1",
      bytes: AGENT_RUN_WORKER_MAX_CREDIT_BYTES,
    });

    assertThrows(
      () =>
        assertValidAgentRunWorkerControlCommand({
          type: "agent-stream-credit",
          commandId: crypto.randomUUID(),
          runId: "run_1",
          bytes: AGENT_RUN_WORKER_MAX_CREDIT_BYTES + 1,
        }),
      RangeError,
      "credit",
    );
  });

  it("rejects accessors before reading execution-bundle properties", () => {
    const bundle = createBundle();
    let accessorCalls = 0;
    Object.defineProperty(bundle.run, "agentId", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "assistant-1";
      },
    });

    assertThrows(
      () => assertValidAgentRunExecutionBundle(bundle),
      TypeError,
      "enumerable data properties",
    );
    assertEquals(accessorCalls, 0);
  });

  it("rejects ambiguous control results and unsupported event properties", () => {
    const commandId = crypto.randomUUID();
    assertThrows(
      () =>
        assertValidAgentRunWorkerControlResult({
          type: "agent-run-control-result",
          commandId,
          runId: "run_1",
          operation: "cancel",
          ok: 0,
          errorCode: "RUN_NOT_ACTIVE",
        } as never),
      TypeError,
      "outcome",
    );
    assertThrows(
      () =>
        assertValidAgentRunWorkerEvent({
          type: "agent-stream-started",
          id: "request_1",
          runId: "run_1",
          ignored: true,
        } as never),
      TypeError,
      "unsupported property",
    );
  });

  it("rejects non-JSON resume values before crossing the Worker boundary", () => {
    assertThrows(
      () =>
        assertValidAgentRunWorkerControlCommand({
          type: "agent-run-resume",
          commandId: crypto.randomUUID(),
          runId: "run_1",
          toolCallId: "tool_1",
          result: Number.NaN,
          isError: false,
        }),
      TypeError,
      "finite numbers",
    );
  });
});
