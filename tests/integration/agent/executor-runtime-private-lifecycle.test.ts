import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/factory.ts";
import { executorAgentFailureCode } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { createExecutorRuntimePreparation } from "#veryfront/agent/hosted/executor-runtime-prepare.ts";

describe("executor runtime private lifecycle", () => {
  it("classifies private errors without exposing them to a replaced descriptor intrinsic", () => {
    const original = Object.getOwnPropertyDescriptor;
    const privateError = { code: "PERMISSION_DENIED", detail: "Synthetic private detail" };
    let exposures = 0;
    let code: string | undefined;
    try {
      Object.getOwnPropertyDescriptor = (value, key) => {
        if (value === privateError) exposures++;
        return original(value, key);
      };
      code = executorAgentFailureCode(privateError, "EXECUTOR_AGENT_SETUP_FAILED");
    } finally {
      Object.getOwnPropertyDescriptor = original;
    }
    assertEquals(code, "PERMISSION_DENIED");
    assertEquals(exposures, 0);
  });

  it("releases prepared facades and discovery after project code replaces promise chaining", async () => {
    const binding = { allocationId: "lifecycle", invocationId: "lifecycle", generation: 1 };
    const source = { type: "release", releaseId: "synthetic-release" } as const;
    const modelId = "veryfront-cloud/openai/gpt-5.4";
    const coder = agent({
      id: "coder",
      system: "Synthetic source instructions.",
      model: modelId,
      tools: {},
    });
    let facadeCleanups = 0;
    let discoveryCleanups = 0;
    const discovery = createExecutorDiscovery({
      binding,
      source,
      projectDir: "/synthetic-project",
      signal: new AbortController().signal,
      backend: {
        load: () =>
          Promise.resolve({
            agents: new Map([[coder.id, coder]]),
            tools: new Map(),
            skills: new Map(),
            prompts: new Map(),
            resources: new Map(),
            workflows: new Map(),
            tasks: new Map(),
            schedules: new Map(),
            webhooks: new Map(),
            evals: new Map(),
            errors: [],
            sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
          }),
        cleanup: () => {
          discoveryCleanups++;
          return Promise.resolve();
        },
      },
    });
    const owner = createExecutorRuntimePreparation({
      binding,
      source,
      discovery,
      grant: {
        agentId: "coder",
        defaultModelId: modelId,
        maxSteps: 5,
        models: new Map([[modelId, { maxOutputTokens: 200, providerToolNames: [] }]]),
        allowedToolNames: [],
        hostToolFacadeIds: [],
        remoteToolSourceIds: [],
        execution: { kind: "ephemeral", projectId: null },
      },
      facades: {
        hostTools: new Map(),
        remoteToolSources: new Map(),
        resolveModelRuntime: () => ({
          modelId: "gpt-5.4",
          provider: "openai",
          specificationVersion: "v3",
          doGenerate: () => Promise.reject(new Error("Unexpected generate call")),
          doStream: () => Promise.reject(new Error("Unexpected stream call")),
        }),
        cleanup: () => {
          facadeCleanups++;
          return Promise.resolve();
        },
      },
    });
    const originalThen = Promise.prototype.then;
    try {
      const operation = owner.operations.get("runtime.prepare");
      assert(operation?.mode === "unary");
      const result = await operation.handle({ agentId: "coder" }, {
        binding,
        signal: new AbortController().signal,
        deadline: Date.now() + 30_000,
      });
      assertEquals((result as { ok?: boolean }).ok, true, JSON.stringify(result));
      Promise.prototype.then = (() => Promise.resolve()) as typeof originalThen;
      await owner.close();
    } finally {
      Promise.prototype.then = originalThen;
      await owner.close();
    }
    assertEquals(facadeCleanups, 1);
    assertEquals(discoveryCleanups, 1);
    await owner.settled;
  });
});
