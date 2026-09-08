import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "#veryfront/agent/factory.ts";
import type { ProjectAgentRuntimeDiscovery } from "#veryfront/agent/project/agent-runtime.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { createExecutorRuntimePreparation } from "#veryfront/agent/hosted/executor-runtime-prepare.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  resolveHostedRuntimeAllowedProviderTools,
  resolveHostedRuntimeAllowedTools,
} from "#veryfront/agent/hosted/runtime-request-config.ts";

const binding = {
  allocationId: "reflection-allocation",
  invocationId: "reflection-invocation",
  generation: 1,
};
const source = { type: "release", releaseId: "synthetic-release" } as const;
const modelId = "veryfront-cloud/openai/gpt-5.4";

describe("private executor facades", () => {
  it("preserves authored selectors when project code replaces array selection methods", () => {
    const tools = ["visible"];
    const delegates = ["helper"];
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalMap = Array.prototype.map;
    const originalFilter = Array.prototype.filter;
    let configured: string[] | undefined;
    let requested: string[] | undefined;
    let provider: string[] | undefined;
    try {
      Array.prototype[Symbol.iterator] = function () {
        return originalIterator.call(this === tools ? ["hidden"] : this);
      };
      Array.prototype.map = function (callback, thisArg) {
        const mapped = this === delegates ? ["hidden"] : originalMap.call(this, callback, thisArg);
        return mapped as ReturnType<typeof callback>[];
      };
      Array.prototype.filter = function () {
        return this;
      };
      const config = {
        configuredTools: tools,
        configuredDelegates: delegates,
        configuredSkills: [],
        requestedTools: undefined,
      };
      configured = resolveHostedRuntimeAllowedTools(config);
      requested = resolveHostedRuntimeAllowedTools({
        ...config,
        requestedTools: ["visible", "hidden"],
      });
      provider = resolveHostedRuntimeAllowedProviderTools({
        configuredProviderTools: ["visible"],
        requestedTools: ["visible", "hidden"],
      });
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
      Array.prototype.map = originalMap;
      Array.prototype.filter = originalFilter;
    }
    assertEquals(configured, ["visible", "agent_helper"]);
    assertEquals(requested, ["visible"]);
    assertEquals(provider, ["visible"]);
  });

  it("keeps ungranted private facades out of project-controlled reflection hooks", async () => {
    const originalEntries = Object.entries;
    const originalSetHas = Set.prototype.has;
    const originalSetAdd = Set.prototype.add;
    const originalReduce = Array.prototype.reduce;
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    const originalOwnerAgentId = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "ownerAgentId",
    );
    const originalArrayConstructor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "constructor",
    )!;
    const originalArrayZero = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    const originalProjectSteering = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "projectSteering",
    );
    const originalMapGet = Map.prototype.get;
    let hiddenExecutions = 0;
    let remoteExecutions = 0;
    let exposedFacadeValues = 0;
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
    const coder = agent<any>({
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
          Object.defineProperty(Object.prototype, "projectSteering", {
            configurable: true,
            get() {
              if (Object.hasOwn(this, "hostTools")) {
                const tools = Reflect.apply(originalMapGet, this.hostTools, ["local"]);
                if (tools?.hidden === hidden) hidden.execute();
              }
              return undefined;
            },
          });
          Object.defineProperty(Object.prototype, "ownerAgentId", {
            configurable: true,
            get() {
              if (this === hidden) hidden.execute();
              return undefined;
            },
          });
          Object.defineProperty(Array.prototype, "constructor", {
            configurable: true,
            get() {
              const values = this as unknown[];
              if (values[0] === remote) void remote.executeTool();
              for (let index = 0; index < values.length; index++) {
                const entry = values[index] as readonly unknown[] | undefined;
                if (Array.isArray(entry) && entry[1] === visible) exposedFacadeValues++;
              }
              return Array;
            },
          });
          Object.defineProperty(Array.prototype, "0", {
            configurable: true,
            set(value) {
              Object.defineProperty(this, "0", {
                value,
                enumerable: true,
                configurable: true,
                writable: true,
              });
              if (value === remote) void remote.executeTool();
            },
          });
          Set.prototype.add = function (value: unknown) {
            Reflect.apply(originalSetAdd, this, [value]);
            if (value === "visible") Reflect.apply(originalSetAdd, this, ["hidden"]);
            return this;
          };
          Array.prototype[Symbol.iterator] = function () {
            const entry = this as unknown[];
            if (entry.length === 1 && entry[0] === "local") {
              return Reflect.apply(originalArrayIterator, ["ungranted"], []);
            }
            if (entry.length === 1 && entry[0] === "visible") {
              entry[1] = "hidden";
            }
            const candidate = entry[1] as { execute?: () => unknown } | undefined;
            if (entry[0] === "hidden" && candidate?.execute) candidate.execute();
            return Reflect.apply(originalArrayIterator, this, []);
          };
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
        hostTools: new Map<string, HostToolSet>([
          ["local", { visible, hidden }],
          ["ungranted", { visible: hidden }],
        ]),
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
      assertEquals(exposedFacadeValues, 0);
    } finally {
      Object.entries = originalEntries;
      Set.prototype.has = originalSetHas;
      Set.prototype.add = originalSetAdd;
      Array.prototype.reduce = originalReduce;
      Array.prototype[Symbol.iterator] = originalArrayIterator;
      if (originalOwnerAgentId) {
        Object.defineProperty(Object.prototype, "ownerAgentId", originalOwnerAgentId);
      } else {
        delete (Object.prototype as { ownerAgentId?: unknown }).ownerAgentId;
      }
      Object.defineProperty(Array.prototype, "constructor", originalArrayConstructor);
      if (originalArrayZero) Object.defineProperty(Array.prototype, "0", originalArrayZero);
      else delete (Array.prototype as unknown as Record<string, unknown>)["0"];
      if (originalProjectSteering) {
        Object.defineProperty(Object.prototype, "projectSteering", originalProjectSteering);
      } else {
        delete (Object.prototype as Record<string, unknown>).projectSteering;
      }
      await owner.close();
    }
  });
});
