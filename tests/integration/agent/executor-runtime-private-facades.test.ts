import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "#veryfront/agent/factory.ts";
import type { ProjectAgentRuntimeDiscovery } from "#veryfront/agent/project/agent-runtime.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { createExecutorRuntimePreparation } from "#veryfront/agent/hosted/executor-runtime-prepare.ts";

const binding = {
  allocationId: "reflection-allocation",
  invocationId: "reflection-invocation",
  generation: 1,
};
const source = { type: "release", releaseId: "synthetic-release" } as const;
const modelId = "veryfront-cloud/openai/gpt-5.4";

it("keeps ungranted private facades out of project-controlled reflection hooks", async () => {
  const originalEntries = Object.entries;
  const originalSetHas = Set.prototype.has;
  const originalReduce = Array.prototype.reduce;
  let hiddenExecutions = 0;
  let remoteExecutions = 0;
  const visible = {
    description: "Synthetic tool",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => ({ ok: true }),
  };
  const hidden = {
    ...visible,
    execute: () => {
      hiddenExecutions++;
      return { ok: true };
    },
  };
  const coder = agent({
    id: "coder",
    system: "Synthetic instructions",
    model: modelId,
    tools: true,
    mcpServers: [{ kind: "veryfront-api", id: "api" }],
  });
  const remote = {
    id: "api",
    listTools: () => Promise.resolve([]),
    executeTool: () => {
      remoteExecutions++;
      return Promise.resolve({ ok: true });
    },
  };
  const runtime: ProjectAgentRuntimeDiscovery = {
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
  };
  const discovery = createExecutorDiscovery({
    binding,
    source,
    projectDir: "/synthetic-project",
    signal: new AbortController().signal,
    backend: {
      load: () => {
        Object.entries = ((value: object) => {
          const entries = Reflect.apply(originalEntries, Object, [value]);
          for (let index = 0; index < entries.length; index++) {
            if (entries[index]?.[1] === hidden) hidden.execute();
          }
          return entries;
        }) as typeof Object.entries;
        Set.prototype.has = function (value: unknown) {
          if (
            value === "hidden" &&
            Reflect.apply(originalSetHas, this, ["visible"]) === true
          ) {
            return true;
          }
          return Reflect.apply(originalSetHas, this, [value]);
        };
        Array.prototype.reduce = (function (
          this: unknown[],
          callback: (...args: unknown[]) => unknown,
          ...initial: unknown[]
        ) {
          if (initial[0] === remote) void remote.executeTool();
          return Reflect.apply(originalReduce, this, [callback, ...initial]);
        }) as typeof Array.prototype.reduce;
        return Promise.resolve(runtime);
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
      allowedToolNames: ["visible"],
      hostToolFacadeIds: ["local"],
      remoteToolSourceIds: ["api"],
      execution: { kind: "ephemeral", projectId: null },
    },
    facades: {
      hostTools: new Map([["local", { visible, hidden }]]),
      remoteToolSources: new Map([["api", remote]]),
      resolveModelRuntime: () => ({
        modelId: "gpt-5.4",
        provider: "openai",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate call")),
        doStream: () => Promise.reject(new Error("Unexpected stream call")),
      }),
      cleanup: () => Promise.resolve(),
    },
  });
  try {
    const operation = owner.operations.get("runtime.prepare");
    assert(operation?.mode === "unary");
    const result = await operation.handle({ agentId: "coder" }, {
      binding,
      signal: new AbortController().signal,
      deadline: Date.now() + 30_000,
    });
    assertEquals((result as { ok?: boolean }).ok, true, JSON.stringify(result));
    assertEquals(hiddenExecutions, 0);
    assertEquals(remoteExecutions, 0);
  } finally {
    Object.entries = originalEntries;
    Set.prototype.has = originalSetHas;
    Array.prototype.reduce = originalReduce;
    await owner.close();
  }
});
