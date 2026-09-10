import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool/factory.ts";
import { agent } from "../factory.ts";
import type { ProjectAgentRuntimeDiscovery } from "../project/agent-runtime.ts";
import { createExecutorDiscovery } from "./executor-discovery.ts";
import { createExecutorProjectToolRuntime } from "./executor-project-runtime.ts";
import {
  getExecutorProjectToolInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";

const binding = { allocationId: "allocation", invocationId: "invocation", generation: 1 };
const source = { type: "release", releaseId: "synthetic-release" } as const;
const install = () =>
  parseExecutorInstallation(getExecutorProjectToolInstallSchema(), {
    version: 1,
    mode: "project-tools",
    binding,
    source,
    root: "project",
    owner: { scopeKind: "global", serviceName: "synthetic-service" },
    context: { agentId: "coder", projectId: "synthetic-project", runId: "synthetic-run" },
    allowedToolNames: ["inspect"],
    maxCalls: 32,
    maxConcurrent: 2,
  });
function fixture(wait?: Promise<void>, onLoad?: () => void) {
  let cleaned = 0;
  let loads = 0;
  let calls = 0;
  const started = Promise.withResolvers<void>();
  const lifetime = new AbortController();
  const registered = tool({
    id: "inspect",
    description: "Inspect an approved argument",
    inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
    execute: async (args, context) => {
      calls++;
      started.resolve();
      await wait;
      return {
        query: args.query,
        agentId: context?.agentId,
        projectId: context?.projectId,
        runId: context?.runId,
      };
    },
  });
  const coder = agent({
    id: "coder",
    system: "Synthetic project instructions",
    model: "openai/synthetic",
    tools: true,
  });
  const runtime: ProjectAgentRuntimeDiscovery = {
    agents: new Map([["coder", coder]]),
    tools: new Map([["inspect", registered]]),
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
  };
  const discovery = createExecutorDiscovery({
    binding,
    source,
    signal: lifetime.signal,
    projectDir: "/synthetic-project",
    backend: {
      load: () => {
        loads++;
        onLoad?.();
        return Promise.resolve(runtime);
      },
      cleanup: () => {
        cleaned++;
        return Promise.resolve();
      },
    },
  });
  return {
    discovery,
    lifetime,
    started: started.promise,
    get loads() {
      return loads;
    },
    get cleaned() {
      return cleaned;
    },
    get calls() {
      return calls;
    },
  };
}

describe("installed project tool runtime", () => {
  it("keeps original cleanup when discovery replaces the public close callback", async () => {
    const input = install();
    input.context.agentId = "missing";
    const f = fixture(undefined, () => {
      f.discovery.close = () => Promise.resolve();
    });
    await assertRejects(() =>
      createExecutorProjectToolRuntime({
        input,
        discovery: f.discovery,
        signal: f.lifetime.signal,
        deadline: Date.now() + 10_000,
      })
    );
    assertEquals(f.loads, 1);
    assertEquals(f.cleaned, 1);
  });

  it("captures admitted authority before project loading can mutate the caller input", async () => {
    const input = install();
    const f = fixture(undefined, () => {
      input.context.agentId = "foreign";
      input.context.runId = "foreign-run";
      input.allowedToolNames.length = 0;
      input.maxCalls = 1;
      input.binding.generation = 2;
    });
    const owner = await createExecutorProjectToolRuntime({
      input,
      discovery: f.discovery,
      signal: f.lifetime.signal,
      deadline: Date.now() + 10_000,
    });
    try {
      const operation = owner.operations.get("tool.execute");
      assert(operation?.mode === "stream");
      const frames = await Array.fromAsync(operation.handle({
        sourceId: "project",
        toolName: "inspect",
        toolCallId: "call",
        args: { query: "approved" },
      }, { binding, signal: f.lifetime.signal, deadline: Date.now() + 10_000 }));
      assertEquals(frames, [{
        type: "result",
        result: {
          query: "approved",
          agentId: "coder",
          projectId: "synthetic-project",
          runId: "synthetic-run",
        },
      }]);
    } finally {
      await owner.close();
    }
  });

  it("loads the bound project and executes only an explicitly granted project tool", async () => {
    const f = fixture();
    const owner = await createExecutorProjectToolRuntime({
      input: install(),
      discovery: f.discovery,
      signal: f.lifetime.signal,
      deadline: Date.now() + 10_000,
    });
    try {
      assertEquals(owner.operations.has("agent.stream"), false);
      assertEquals(owner.operations.has("runtime.prepare"), false);
      const operation = owner.operations.get("tool.execute");
      assert(operation?.mode === "stream");
      const context = { binding, signal: f.lifetime.signal, deadline: Date.now() + 10_000 };
      const frames = await Array.fromAsync(
        operation.handle({
          sourceId: "project",
          toolName: "inspect",
          toolCallId: "call",
          args: { query: "approved" },
        }, context),
      );
      assertEquals(frames, [{
        type: "result",
        result: {
          query: "approved",
          agentId: "coder",
          projectId: "synthetic-project",
          runId: "synthetic-run",
        },
      }]);
      const denied = await Array.fromAsync(
        operation.handle({
          sourceId: "project",
          toolName: "ungranted",
          toolCallId: "denied",
          args: {},
        }, context),
      );
      const failure = denied[0];
      assert(failure !== null && typeof failure === "object" && !Array.isArray(failure));
      assertEquals(failure.type, "failure");
      assertEquals(f.calls, 1);
    } finally {
      await owner.close();
    }
    assertEquals(f.cleaned, 1);
  });
  it("cleans up failed or expired discovery without installing tool operations", async () => {
    for (const expired of [false, true]) {
      const f = fixture();
      const input = install();
      if (!expired) input.context.agentId = "missing";
      await assertRejects(() =>
        createExecutorProjectToolRuntime({
          input,
          discovery: f.discovery,
          signal: f.lifetime.signal,
          deadline: expired ? Date.now() - 1 : Date.now() + 10_000,
        })
      );
      assertEquals(f.loads, expired ? 0 : 1);
      assertEquals(f.cleaned, expired ? 0 : 1);
      assertEquals(f.calls, 0);
    }
  });
  it("keeps project resources until a noncooperative tool settles after cancellation", async () => {
    const pending = Promise.withResolvers<void>();
    const f = fixture(pending.promise);
    const owner = await createExecutorProjectToolRuntime({
      input: install(),
      discovery: f.discovery,
      signal: f.lifetime.signal,
      deadline: Date.now() + 10_000,
    });
    const operation = owner.operations.get("tool.execute");
    assert(operation?.mode === "stream");
    const execution = Array.fromAsync(
      operation.handle({
        sourceId: "project",
        toolName: "inspect",
        toolCallId: "call",
        args: { query: "approved" },
      }, { binding, signal: f.lifetime.signal, deadline: Date.now() + 10_000 }),
    );
    const rejected = assertRejects(() => execution);
    await f.started;
    const closing = owner.close();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(f.cleaned, 0);
    pending.resolve();
    await rejected;
    await closing;
    assertEquals(f.cleaned, 1);
  });
});
