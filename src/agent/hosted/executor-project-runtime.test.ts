import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { tool } from "#veryfront/tool/factory.ts";
import { markRuntimeLocalTool } from "#veryfront/agent/runtime/local-tool.ts";
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
function fixture(
  wait?: Promise<void>,
  onLoad?: () => void,
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest = {
    schemaVersion: 1 as const,
    mode: "unrestricted" as const,
  },
  onExecute?: () => unknown,
) {
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
      const executed = onExecute?.();
      return {
        query: args.query,
        agentId: context?.agentId,
        projectId: context?.projectId,
        runId: context?.runId,
        ...(context?.userId === undefined ? {} : { userId: context.userId }),
        ...(context?.projectSlug === undefined ? {} : { projectSlug: context.projectSlug }),
        ...(executed === undefined ? {} : { executed }),
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
    sourceIntegrationPolicy,
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
    runtime,
    registered,
    coder,
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
  it("constructs project tool metadata under the admitted source policy", async () => {
    const denyAll = { schemaVersion: 1 as const, mode: "allowlist" as const, integrations: {} };
    const observed: unknown[] = [];
    const f = fixture(undefined, () => {
      Object.defineProperty(f.registered, "description", {
        get() {
          observed.push(getActiveSourceIntegrationPolicy());
          return "Inspect under policy";
        },
      });
    }, denyAll);
    const owner = await createExecutorProjectToolRuntime({
      input: install(),
      discovery: f.discovery,
      signal: f.lifetime.signal,
      deadline: Date.now() + 10_000,
    });
    try {
      assert(observed.length > 0);
      for (const policy of observed) assertEquals(policy, denyAll);
    } finally {
      await owner.close();
    }
  });

  it("copies runtime catalogs without consulting replaceable map methods", async () => {
    const f = fixture(undefined, () => {
      const forbidden = () => {
        throw new Error("Replaceable map operation reached");
      };
      Object.defineProperties(f.runtime.tools, {
        [Symbol.iterator]: { value: forbidden },
        set: { value: forbidden },
      });
      Object.defineProperty(f.runtime.agents, "get", { value: forbidden });
    });
    const owner = await createExecutorProjectToolRuntime({
      input: install(),
      discovery: f.discovery,
      signal: f.lifetime.signal,
      deadline: Date.now() + 10_000,
    });
    try {
      const execute = owner.operations.get("tool.execute");
      assert(execute?.mode === "stream");
      const frames = await Array.fromAsync(execute.handle({
        sourceId: "project",
        toolName: "inspect",
        toolCallId: "call",
        args: { query: "approved" },
      }, { binding, signal: f.lifetime.signal, deadline: Date.now() + 10_000 }));
      assert(frames[0] && typeof frames[0] === "object" && !Array.isArray(frames[0]));
      assertEquals(frames[0].type, "result");
      assertEquals(f.calls, 1);
    } finally {
      await owner.close();
    }
  });

  it("excludes runtime-generated tools even when their names appear in the project grant", async () => {
    let delegated = 0;
    const local = markRuntimeLocalTool(tool({
      id: "generated-delegate",
      description: "Runtime-only delegate",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => {
        delegated++;
        return null;
      },
    }));
    const f = fixture();
    f.coder.config.tools = { inspect: f.registered, "generated-delegate": local };
    f.runtime.tools.set("generated-delegate", local);
    const input = install();
    input.allowedToolNames.push("generated-delegate");
    const owner = await createExecutorProjectToolRuntime({
      input,
      discovery: f.discovery,
      signal: f.lifetime.signal,
      deadline: Date.now() + 10_000,
    });
    try {
      const execute = owner.operations.get("tool.execute");
      assert(execute?.mode === "stream");
      assertEquals(
        await Array.fromAsync(execute.handle({
          sourceId: "project",
          toolName: "generated-delegate",
          toolCallId: "call",
          args: {},
        }, { binding, signal: f.lifetime.signal, deadline: Date.now() + 10_000 })),
        [{ type: "failure" }],
      );
      assertEquals(delegated, 0);
    } finally {
      await owner.close();
    }
  });

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
    input.context.userId = "synthetic-user";
    input.context.projectSlug = "synthetic-slug";
    const f = fixture(undefined, () => {
      input.context.agentId = "foreign";
      input.context.runId = "foreign-run";
      input.context.userId = "foreign-user";
      input.context.projectSlug = "foreign-slug";
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
          userId: "synthetic-user",
          projectSlug: "synthetic-slug",
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

  it("restores the source integration policy while project tools execute", async () => {
    const denyAll = { schemaVersion: 1 as const, mode: "allowlist" as const, integrations: {} };
    const f = fixture(undefined, undefined, denyAll, () => getActiveSourceIntegrationPolicy());
    const owner = await createExecutorProjectToolRuntime({
      input: install(),
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
        toolCallId: "policy",
        args: { query: "policy" },
      }, { binding, signal: f.lifetime.signal, deadline: Date.now() + 10_000 }));
      assertEquals(frames, [{
        type: "result",
        result: {
          query: "policy",
          agentId: "coder",
          projectId: "synthetic-project",
          runId: "synthetic-run",
          executed: denyAll,
        },
      }]);
    } finally {
      await owner.close();
    }
  });
});
