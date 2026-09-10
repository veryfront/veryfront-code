import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { tool } from "#veryfront/tool/factory.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  createExecutorProjectToolOperations,
  warmExecutorProjectToolSchemas,
} from "#veryfront/agent/hosted/executor-project-tools.ts";
import { warmExecutorToolSchemas } from "#veryfront/agent/hosted/executor-tool-schema.ts";
import { runWithProjectAgentRuntime } from "#veryfront/agent/project/agent-runtime.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";

it("establishes project policy before restoring authored collection hooks", async () => {
  const binding = { allocationId: "allocation", generation: 1, invocationId: "invocation" };
  const signal = new AbortController().signal;
  const parent: SourceIntegrationPolicyManifest = {
    schemaVersion: 1,
    mode: "allowlist",
    integrations: { synthetic: { allowedToolIds: ["allowed", "denied"] } },
  };
  const project: SourceIntegrationPolicyManifest = {
    schemaVersion: 1,
    mode: "allowlist",
    integrations: { synthetic: { allowedToolIds: ["allowed"] } },
  };
  const registered = tool({
    id: "inspect",
    description: "Inspect scoped policy",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: async () => ({
      policy: getActiveSourceIntegrationPolicy(),
      hooked: new Set().has("denied"),
    }),
  });
  warmExecutorToolSchemas();
  warmExecutorProjectToolSchemas();
  const originalHas = Set.prototype.has;
  const apply = Reflect.apply;
  try {
    Set.prototype.has = function (value) {
      return value === "denied" || apply(originalHas, this, [value]);
    };
    const operations = createExecutorProjectToolOperations({
      scope: { binding, signal, assertActive() {} },
      context: { agentId: "coder", projectId: "project", execution: { kind: "ephemeral" } },
      tools: new Map([["inspect", registered]]),
      allowedToolNames: new Set(["inspect"]),
      maxCalls: 8,
      maxConcurrent: 1,
      runWithProjectRuntime: (fn) =>
        runWithProjectAgentRuntime({ sourceIntegrationPolicy: project }, fn),
    });
    const operation = operations.get("tool.execute");
    assert(operation?.mode === "stream");
    const frames = await runWithExactSourceIntegrationPolicy(
      parent,
      () =>
        Array.fromAsync(operation.handle({
          sourceId: "project",
          toolName: "inspect",
          toolCallId: "call",
          args: {},
        }, { binding, signal, deadline: Date.now() + 10_000 })),
    );
    assertEquals<unknown>(frames, [{ type: "result", result: { policy: project, hooked: true } }]);
    assertEquals(Set.prototype.has, originalHas);
  } finally {
    Set.prototype.has = originalHas;
  }
});

for (const replacement of ["readonly", "throwing-accessor"] as const) {
  it(`releases all queued calls when ${replacement} prevents intrinsic restoration`, async () => {
    const binding = { allocationId: "allocation", generation: 1, invocationId: "invocation" };
    const signal = new AbortController().signal;
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const original = Object.getOwnPropertyDescriptor(Set.prototype, "has")!;
    const originalHas = Set.prototype.has;
    const apply = Reflect.apply;
    let calls = 0;
    const registered = tool({
      id: "inspect",
      description: "Prevent prototype restoration",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => {
        calls++;
        entered.resolve();
        await finish.promise;
        if (replacement === "readonly") {
          Object.defineProperty(Set.prototype, "has", { writable: false });
        } else {Object.defineProperty(Set.prototype, "has", {
            configurable: true,
            get() {
              throw new Error("Project membership getter");
            },
          });}
        return null;
      },
    });
    warmExecutorToolSchemas();
    warmExecutorProjectToolSchemas();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      Set.prototype.has = function (value) {
        return value === "denied" || apply(originalHas, this, [value]);
      };
      const operations = createExecutorProjectToolOperations({
        scope: { binding, signal, assertActive() {} },
        context: { agentId: "coder", projectId: "project", execution: { kind: "ephemeral" } },
        tools: new Map([["inspect", registered]]),
        allowedToolNames: new Set(["inspect"]),
        maxCalls: 8,
        maxConcurrent: 3,
      });
      const operation = operations.get("tool.execute");
      assert(operation?.mode === "stream");
      const execute = () =>
        Array.fromAsync(operation.handle({
          sourceId: "project",
          toolName: "inspect",
          toolCallId: "call",
          args: {},
        }, { binding, signal, deadline: Date.now() + 10_000 }));
      const first = execute();
      await entered.promise;
      const queued = execute();
      const third = execute();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      finish.resolve();
      const settled = await Promise.race([
        Promise.all([first, queued, third]),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 500);
        }),
      ]);
      assertEquals(settled, [[{ type: "failure" }], [{ type: "failure" }], [{ type: "failure" }]]);
      assertEquals(await execute(), [{ type: "failure" }]);
      assertEquals(calls, 1);
    } finally {
      clearTimeout(timer);
      finish.resolve();
      Object.defineProperty(Set.prototype, "has", original);
    }
  });
}
