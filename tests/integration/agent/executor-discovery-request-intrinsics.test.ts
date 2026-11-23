import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/factory.ts";
import type { ProjectAgentRuntimeDiscovery } from "#veryfront/agent/project/agent-runtime.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { getExecutorAgentDescribeResultSchema } from "#veryfront/agent/hosted/executor-discovery-schema.ts";

it("parses discovery requests after agent-first project loading without constructing new request schemas", async () => {
  const binding = { allocationId: "allocation", invocationId: "invocation", generation: 1 };
  const lifetime = new AbortController();
  const originalEvery = Array.prototype.every;
  const coder = agent({ id: "coder", system: "Synthetic instructions", model: "openai/synthetic" });
  const runtime: ProjectAgentRuntimeDiscovery = {
    agents: new Map([["coder", coder]]),
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
  const owner = createExecutorDiscovery({
    binding,
    source: { type: "release", releaseId: "synthetic-release" },
    signal: lifetime.signal,
    projectDir: "/synthetic-project",
    backend: {
      load() {
        Array.prototype.every = function (
          this: unknown[],
          callback: (value: unknown, index: number, array: unknown[]) => unknown,
          thisArg?: unknown,
        ): boolean {
          // Target the schema-factory contract check while preserving unrelated
          // collection behavior used by normal discovery and validation.
          if (this[0] === "optional" && this[this.length - 1] === "safeParse") {
            throw new Error("Project code reached late schema construction");
          }
          return Reflect.apply(originalEvery, this, [callback, thisArg]);
        } as typeof originalEvery;
        return Promise.resolve(runtime);
      },
      cleanup: () => Promise.resolve(),
    },
  });
  try {
    const context = { binding, signal: lifetime.signal, deadline: Date.now() + 10_000 };
    const describeAgent = owner.operations.get("agent.describe");
    const describeDiscovery = owner.operations.get("discovery.describe");
    assert(describeAgent?.mode === "unary" && describeDiscovery?.mode === "unary");
    const first = await describeAgent.handle({ agentId: "coder" }, context);
    assert(first && typeof first === "object" && !Array.isArray(first) && first.ok === true);
    // Project-only installation also validates this complete result after an
    // earlier discovery request may already have loaded the project.
    assert(getExecutorAgentDescribeResultSchema().safeParse(first).success);
    const discovery = await describeDiscovery.handle({}, context);
    assert(
      discovery && typeof discovery === "object" && !Array.isArray(discovery) &&
        discovery.ok === true,
    );
    const invalid = await describeDiscovery.handle({ unexpected: true }, context);
    assert(
      invalid && typeof invalid === "object" && !Array.isArray(invalid) && invalid.ok === false,
    );
  } finally {
    Array.prototype.every = originalEvery;
    await owner.close();
  }
});

it("selected candidate metadata does not consult project-controlled array species", async () => {
  const binding = {
    allocationId: "selected-allocation",
    invocationId: "selected-invocation",
    generation: 1,
  };
  const originalArray = Array;
  const defineProperty = Object.defineProperty;
  const constructorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "constructor")!;
  const runtime: ProjectAgentRuntimeDiscovery = {
    agents: new Map(
      ["coder", "internal"].map(
        (id) => [id, agent({ id, system: "Synthetic instructions", model: "openai/synthetic" })],
      ),
    ),
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
  const owner = createExecutorDiscovery({
    binding,
    source: { type: "release", releaseId: "synthetic-release" },
    projectDir: "/synthetic-project",
    defaultAgentId: "coder",
    agentEntrypoint: { path: "agents/selected.ts" },
    signal: new AbortController().signal,
    backend: {
      load() {
        defineProperty(originalArray.prototype, "constructor", {
          configurable: true,
          get() {
            if (
              this.length !== 2 || this[0] !== "coder" || this[1] !== "internal"
            ) return originalArray;
            return class extends originalArray {
              constructor(length: number) {
                super(length);
                if (length === 0) this[1] = "internal";
              }
            };
          },
        });
        return Promise.resolve(runtime);
      },
      cleanup: () => Promise.resolve(),
    },
  });
  try {
    const operation = owner.operations.get("discovery.describe");
    assert(operation?.mode === "unary");
    const result = await operation.handle({}, {
      binding,
      signal: new AbortController().signal,
      deadline: Date.now() + 10_000,
    });
    defineProperty(originalArray.prototype, "constructor", constructorDescriptor);
    assert(result && typeof result === "object" && !Array.isArray(result) && result.ok === true);
    assertEquals((result.value as { candidates: unknown }).candidates, {
      codeAgentIds: ["coder"],
      markdownAgentIds: [],
    });
  } finally {
    defineProperty(originalArray.prototype, "constructor", constructorDescriptor);
    await owner.close();
  }
});
