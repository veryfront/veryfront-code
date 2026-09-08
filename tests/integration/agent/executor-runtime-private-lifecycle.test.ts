import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/factory.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import type { RuntimeToolFilterConfig } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import { executorAgentFailureCode } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { createExecutorRuntimePreparation } from "#veryfront/agent/hosted/executor-runtime-prepare.ts";
import type { ProjectAgentRuntimeDiscovery } from "#veryfront/agent/project/agent-runtime.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";

describe("executor runtime private lifecycle", () => {
  it("propagates operation cancellation after project code replaces listener registration", async () => {
    const binding = { allocationId: "listeners", invocationId: "listeners", generation: 1 };
    const source = { type: "release", releaseId: "synthetic-release" } as const;
    const modelId = "veryfront-cloud/openai/gpt-5.4";
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<ProjectAgentRuntimeDiscovery>();
    let backendSignal: AbortSignal | undefined;
    const discovery = createExecutorDiscovery({
      binding,
      source,
      projectDir: "/synthetic-project",
      signal: new AbortController().signal,
      backend: {
        load: (signal) => {
          backendSignal = signal;
          entered.resolve();
          return finish.promise;
        },
        cleanup: () => Promise.resolve(),
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
        resolveModelRuntime: () => undefined,
        cleanup: () => Promise.resolve(),
      },
    });
    const original = EventTarget.prototype.addEventListener;
    const controller = new AbortController();
    let preparing: JsonValue | Promise<JsonValue> | undefined;
    try {
      EventTarget.prototype.addEventListener = () => {};
      const operation = owner.operations.get("runtime.prepare");
      assert(operation?.mode === "unary");
      preparing = operation.handle({ agentId: "coder" }, {
        binding,
        signal: controller.signal,
        deadline: Date.now() + 30_000,
      });
      await entered.promise;
      controller.abort();
      assertEquals(owner.signal.aborted, true);
      assertEquals(backendSignal?.aborted, true);
    } finally {
      EventTarget.prototype.addEventListener = original;
      finish.reject(new DOMException("Synthetic cancellation", "AbortError"));
      await owner.close();
      await preparing;
    }
  });

  it("retains original producer completion when project code replaces promise latches", async () => {
    const entered = Promise.withResolvers<void>();
    const unblock = Promise.withResolvers<void>();
    const finalizationReleased = Promise.withResolvers<void>();
    let completion: Promise<void> | undefined;
    let completed = false;
    const config: RuntimeToolFilterConfig = {
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic instructions",
      __vfProviderReplayCheckpointTurnFailed: async () => {
        entered.resolve();
        await unblock.promise;
        finalizationReleased.resolve();
      },
    };
    const runtime = new AgentRuntime("synthetic-runtime", config, {
      resolveModelRuntime: () => ({
        provider: "openai",
        modelId: "gpt-5.4",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => Promise.reject(new Error("Synthetic stream failure")),
      }),
      onStreamCompletion: (pending) => {
        completion = pending;
        void pending.then(() => {
          completed = true;
        });
      },
    });
    const original = Promise.withResolvers;
    try {
      Promise.withResolvers = (() => ({
        promise: Promise.resolve(),
        resolve: () => {},
        reject: () => {},
      })) as typeof original;
      const stream = await runtime.stream([{
        id: "synthetic-message",
        role: "user",
        parts: [{ type: "text", text: "Synthetic input" }],
      }]);
      await entered.promise;
      await stream.cancel();
      assert(completion);
      assertEquals(completed, false);
    } finally {
      Promise.withResolvers = original;
      unblock.resolve();
      await finalizationReleased.promise;
      await completion;
    }
    assertEquals(completed, true);
  });

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

  it("releases prepared facades and discovery after project code replaces lifecycle methods", async () => {
    const binding = { allocationId: "lifecycle", invocationId: "lifecycle", generation: 1 };
    const source = { type: "release", releaseId: "synthetic-release" } as const;
    const modelId = "veryfront-cloud/openai/gpt-5.4";
    const coder = agent({
      id: "coder",
      system: "Synthetic source instructions.",
      model: modelId,
      maxSteps: 3,
      tools: {},
    });
    let facadeCleanups = 0;
    let discoveryCleanups = 0;
    const cleanupFinished = Promise.withResolvers<void>();
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
          return cleanupFinished.promise;
        },
      },
    });
    const originalThen = Promise.prototype.then;
    const originalPromiseConstructor = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      "constructor",
    )!;
    const originalAbort = AbortController.prototype.abort;
    const originalMin = Math.min;
    let stepLimitOverrides = 0;
    try {
      Math.min = (...values) => {
        if (values.length === 3 && values[0] === 5 && values[1] === 3 && values[2] === 5) {
          stepLimitOverrides++;
          return 100;
        }
        return originalMin(...values);
      };
      const operation = owner.operations.get("runtime.prepare");
      assert(operation?.mode === "unary");
      const result = await operation.handle({ agentId: "coder" }, {
        binding,
        signal: new AbortController().signal,
        deadline: Date.now() + 30_000,
      });
      assertEquals((result as { ok?: boolean }).ok, true, JSON.stringify(result));
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        writable: true,
        value: function ProjectPromise() {},
      });
      Promise.prototype.then = (function (fulfilled: ((value: unknown) => unknown) | undefined) {
        fulfilled?.(undefined);
        return Promise.resolve();
      }) as typeof originalThen;
      AbortController.prototype.abort = () => {};
      const closing = owner.close();
      await {
        then(resolve: () => void) {
          setTimeout(resolve, 0);
        },
      };
      assertEquals(facadeCleanups, 1);
      assertEquals(discoveryCleanups, 0);
      cleanupFinished.resolve();
      await closing;
    } finally {
      Object.defineProperty(Promise.prototype, "constructor", originalPromiseConstructor);
      Promise.prototype.then = originalThen;
      AbortController.prototype.abort = originalAbort;
      Math.min = originalMin;
      cleanupFinished.resolve();
      await owner.close();
    }
    assertEquals(owner.signal.aborted, true);
    assertEquals(stepLimitOverrides, 0);
    assertEquals(discovery.signal.aborted, true);
    assertEquals(facadeCleanups, 1);
    assertEquals(discoveryCleanups, 1);
    await owner.settled;
  });
});
