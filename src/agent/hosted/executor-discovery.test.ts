import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CONFIG_INVALID } from "#veryfront/errors";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { agent } from "../factory.ts";
import type { Agent } from "../types.ts";
import type { ProjectAgentRuntimeDiscovery } from "../project/agent-runtime.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "../runtime/agent-markdown-adapter.ts";
import { createExecutorDiscovery, type ExecutorDiscoveryBackend } from "./executor-discovery.ts";
import { ExecutorDiscoveryError } from "./executor-discovery-schema.ts";

const binding = { allocationId: "allocation", invocationId: "invocation", generation: 1 };
const source = { type: "release", releaseId: "synthetic-release" } as const;
const codeAgent = (id = "coder") =>
  agent({ id, system: "Synthetic instructions", model: "openai/synthetic" });
const markdownAgent = () =>
  createRuntimeAgentFromMarkdownDefinition({
    id: "writer",
    name: "Writer",
    description: "",
    instructions: "Synthetic markdown",
  });
function runtime(agents: Agent[] = [codeAgent()]): ProjectAgentRuntimeDiscovery {
  return {
    agents: new Map(agents.map((value) => [value.id, value])),
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
}
function fixture(
  input: {
    agents?: Agent[];
    agentSource?: "auto" | "code" | "markdown";
    defaultAgentId?: string;
    backend?: ExecutorDiscoveryBackend;
  } = {},
) {
  let loads = 0;
  let cleanups = 0;
  const state = runtime(input.agents);
  const controller = new AbortController();
  const owner = createExecutorDiscovery({
    binding,
    source,
    projectDir: "/synthetic-project",
    agentSource: input.agentSource,
    defaultAgentId: input.defaultAgentId,
    signal: controller.signal,
    backend: input.backend ?? {
      load: () => {
        loads++;
        return Promise.resolve(state);
      },
      cleanup: () => {
        cleanups++;
        return Promise.resolve();
      },
    },
  });
  return {
    owner,
    state,
    controller,
    get loads() {
      return loads;
    },
    get cleanups() {
      return cleanups;
    },
  };
}
async function call(
  owner: ReturnType<typeof createExecutorDiscovery>,
  name: string,
  value: JsonValue = {},
  context = { binding, signal: new AbortController().signal, deadline: Date.now() + 10_000 },
) {
  const operation = owner.operations.get(name);
  assert(operation?.mode === "unary");
  return await operation.handle(value, context);
}

describe("executor discovery operations", () => {
  it("is lazy, exposes only metadata operations, and retains the runtime locally", async () => {
    const f = fixture();
    try {
      assertEquals(f.loads, 0);
      assertEquals([...f.owner.operations.keys()], ["discovery.describe", "agent.describe"]);
      assertThrows(() => f.owner.getRuntime(), ExecutorDiscoveryError);
      const result = await call(f.owner, "discovery.describe");
      assertEquals(result, {
        ok: true,
        value: {
          source,
          candidates: { codeAgentIds: ["coder"], markdownAgentIds: [] },
          defaultAgentId: "coder",
          definition: {
            id: "coder",
            name: "coder",
            description: "",
            instructions: "Synthetic instructions",
            model: "openai/synthetic",
          },
          errorCount: 0,
        },
      });
      assertEquals(f.owner.getRuntime(), f.state);
      await call(f.owner, "agent.describe", { agentId: "coder" });
      assertEquals(f.loads, 1);
    } finally {
      await f.owner.close();
    }
    assertEquals(f.cleanups, 1);
    assertThrows(() => f.owner.getRuntime(), ExecutorDiscoveryError);
    await f.owner.close();
    assertEquals(f.cleanups, 1);
  });

  for (const policy of ["auto", "code", "markdown"] as const) {
    it(`preserves ${policy} default selection`, async () => {
      const f = fixture({ agents: [codeAgent(), markdownAgent()], agentSource: policy });
      try {
        const result = await call(f.owner, "discovery.describe");
        if (policy === "auto") assertEquals(result, { ok: false, code: "CONFIG_INVALID" });
        else {
          assert(
            result !== null && typeof result === "object" && !Array.isArray(result) &&
              result.ok === true,
          );
          const value = result.value;
          assert(value !== null && typeof value === "object" && !Array.isArray(value));
          assertEquals(value.defaultAgentId, policy === "code" ? "coder" : "writer");
        }
      } finally {
        await f.owner.close();
      }
    });
  }

  it("honors an explicit default and reports missing code agents without guessing", async () => {
    const f = fixture({
      agents: [codeAgent("first"), codeAgent("second")],
      defaultAgentId: "second",
      agentSource: "code",
    });
    try {
      const result = await call(f.owner, "discovery.describe");
      assert(
        result !== null && typeof result === "object" && !Array.isArray(result) &&
          result.ok === true,
      );
      assertEquals(await call(f.owner, "agent.describe", { agentId: "missing" }), {
        ok: false,
        code: "AGENT_NOT_FOUND",
      });
      assertEquals(f.loads, 1);
    } finally {
      await f.owner.close();
    }
  });

  it("preserves filename-derived IDs for code agents without an explicit ID", async () => {
    const discovered = agent({ system: "Filename-bound instructions", model: "openai/synthetic" });
    const originalId = discovered.id;
    const f = fixture({
      agents: [discovered],
      defaultAgentId: "filename-agent",
      agentSource: "code",
    });
    f.state.agents.clear();
    f.state.agents.set("filename-agent", discovered);
    try {
      for (const name of ["discovery.describe", "agent.describe"]) {
        const result = await call(
          f.owner,
          name,
          name === "agent.describe" ? { agentId: "filename-agent" } : {},
        );
        assert(result !== null && typeof result === "object" && !Array.isArray(result));
        assertEquals(result.ok, true);
        const value = result.value;
        assert(value !== null && typeof value === "object" && !Array.isArray(value));
        const definition = value.definition;
        assert(definition !== null && typeof definition === "object" && !Array.isArray(definition));
        assertEquals(definition.id, "filename-agent");
        assertEquals(definition.instructions, "Filename-bound instructions");
      }
      assertEquals(discovered.id, originalId);
      assertEquals(f.cleanups, 0);
    } finally {
      await f.owner.close();
    }
  });

  it("rejects wire paths, source replacement, and wrong bindings before discovery", async () => {
    const f = fixture();
    try {
      const invalidInputs: JsonValue[] = [{ projectDir: "/other" }, { source }, {
        authToken: "synthetic",
      }];
      for (const value of invalidInputs) {
        assertEquals(await call(f.owner, "discovery.describe", value), {
          ok: false,
          code: "EXECUTOR_DISCOVERY_INVALID_INPUT",
        });
      }
      assertEquals(
        await call(f.owner, "agent.describe", { agentId: "coder", projectDir: "/other" }),
        { ok: false, code: "EXECUTOR_DISCOVERY_INVALID_INPUT" },
      );
      assertEquals(
        await call(f.owner, "discovery.describe", {}, {
          binding: { ...binding, generation: 2 },
          signal: new AbortController().signal,
          deadline: Date.now() + 10_000,
        }),
        { ok: false, code: "EXECUTOR_DISCOVERY_BINDING_MISMATCH" },
      );
      assertEquals(f.loads, 0);
    } finally {
      await f.owner.close();
    }
    assertEquals(f.cleanups, 0);
  });

  it("projects an executable system once and preserves structured metadata", async () => {
    let evaluations = 0;
    const f = fixture({
      agents: [agent({
        id: "coder",
        system: () => {
          evaluations++;
          return [{
            role: "system",
            content: "Synthetic system",
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          }];
        },
        tools: { allowed: true, denied: false },
        providerTools: ["web_search"],
        mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["read_file"] } }],
      })],
    });
    try {
      const [first, second] = await Promise.all([
        call(f.owner, "discovery.describe"),
        call(f.owner, "agent.describe", { agentId: "coder" }),
      ]);
      assertEquals(evaluations, 1);
      assert(JSON.stringify(first).includes('"deniedTools":["denied"]'));
      assert(JSON.stringify(second).includes('"cacheControl":{"type":"ephemeral"}'));
    } finally {
      await f.owner.close();
    }
  });

  it("keeps custom MCP transports unsupported and never serializes their functions", async () => {
    const f = fixture({
      agents: [
        agent({
          id: "coder",
          system: "Synthetic",
          mcpServers: [{
            kind: "http",
            id: "custom",
            transport: { type: "http", url: "https://example.test/mcp" },
          }],
        }),
      ],
    });
    try {
      assertEquals(await call(f.owner, "discovery.describe"), {
        ok: false,
        code: "CONFIG_INVALID",
      });
    } finally {
      await f.owner.close();
    }
  });

  it("returns only a count for publish-valid discovery errors", async () => {
    const f = fixture();
    f.state.errors.push({
      file: "/synthetic-private-path",
      error: new Error("synthetic-private-error"),
    });
    try {
      const text = JSON.stringify(await call(f.owner, "discovery.describe"));
      assert(text.includes('"errorCount":1'));
      assertEquals(text.includes("synthetic-private"), false);
    } finally {
      await f.owner.close();
    }
  });

  it("joins canceled discovery before cleaning partial setup and cannot be resurrected", async () => {
    const loaded = Promise.withResolvers<ProjectAgentRuntimeDiscovery>();
    const entered = Promise.withResolvers<void>();
    let cleaned = 0;
    const f = fixture({
      backend: {
        load: () => {
          entered.resolve();
          return loaded.promise;
        },
        cleanup: () => {
          cleaned++;
          return Promise.resolve();
        },
      },
    });
    const response = call(f.owner, "discovery.describe");
    await entered.promise;
    f.controller.abort();
    assertThrows(() => f.owner.getRuntime(), ExecutorDiscoveryError);
    assertEquals(cleaned, 0);
    loaded.resolve(runtime());
    assertEquals(await response, { ok: false, code: "ABORTED" });
    await f.owner.settled;
    assertEquals(cleaned, 1);
    assertEquals(await call(f.owner, "agent.describe", { agentId: "coder" }), {
      ok: false,
      code: "EXECUTOR_DISCOVERY_CLOSED",
    });
  });

  it("cleans failed partial discovery once without echoing its error", async () => {
    let cleaned = 0;
    const f = fixture({
      backend: {
        load: () => Promise.reject(new Error("synthetic-private-error")),
        cleanup: () => {
          cleaned++;
          return Promise.resolve();
        },
      },
    });
    assertEquals(await call(f.owner, "discovery.describe"), {
      ok: false,
      code: "EXECUTOR_DISCOVERY_FAILED",
    });
    await f.owner.close();
    assertEquals(cleaned, 1);
  });

  it("cleans partial discovery even when the loader throws a registered configuration error", async () => {
    let cleaned = 0;
    const f = fixture({
      backend: {
        load: () =>
          Promise.reject(CONFIG_INVALID.create({ detail: "synthetic-private-diagnostic" })),
        cleanup: () => {
          cleaned++;
          return Promise.resolve();
        },
      },
    });
    assertEquals(await call(f.owner, "discovery.describe"), { ok: false, code: "CONFIG_INVALID" });
    assertEquals(cleaned, 1);
    assertEquals(f.owner.signal.aborted, true);
    await f.owner.close();
  });

  it("reports cleanup failure without exposing its diagnostic", async () => {
    const f = fixture({
      backend: {
        load: () => Promise.resolve(runtime()),
        cleanup: () => Promise.reject(new Error("synthetic-private-diagnostic")),
      },
    });
    await call(f.owner, "discovery.describe");
    const error = await assertRejects(() => f.owner.close(), ExecutorDiscoveryError);
    assert(error instanceof ExecutorDiscoveryError);
    assertEquals(error.code, "EXECUTOR_DISCOVERY_CLEANUP_FAILED");
  });

  it("joins the same cleanup promise when close reenters through an abort listener", async () => {
    const cleanup = Promise.withResolvers<void>();
    let cleanups = 0;
    let reentered: Promise<void> | undefined;
    let settled = false;
    const f = fixture({
      backend: {
        load: () => Promise.resolve(runtime()),
        cleanup: () => {
          cleanups++;
          return cleanups === 1 ? cleanup.promise : Promise.resolve();
        },
      },
    });
    await call(f.owner, "discovery.describe");
    f.owner.signal.addEventListener("abort", () => {
      reentered = f.owner.close();
    }, { once: true });
    void f.owner.settled.then(() => settled = true);
    const closing = f.owner.close();
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(reentered, closing);
      assertEquals(cleanups, 1);
      assertEquals(settled, false);
    } finally {
      cleanup.resolve();
      await closing;
      await reentered;
    }
  });

  for (const agentSource of ["auto", "markdown"] as const) {
    it(`keeps ${agentSource} discovery alive after a missing non-file ID`, async () => {
      const f = fixture({ agents: [markdownAgent()], agentSource });
      try {
        await call(f.owner, "discovery.describe");
        assertEquals(await call(f.owner, "agent.describe", { agentId: "missing:agent" }), {
          ok: false,
          code: "AGENT_NOT_FOUND",
        });
        assertEquals(f.owner.signal.aborted, false);
        const valid = await call(f.owner, "agent.describe", { agentId: "writer" });
        assert(
          valid !== null && typeof valid === "object" && !Array.isArray(valid) && valid.ok === true,
        );
      } finally {
        await f.owner.close();
      }
    });
  }

  it("rejects oversized definitions and candidate catalogs", async () => {
    for (
      const agents of [
        [agent({ id: "coder", system: "x".repeat(65_537) })],
        Array.from({ length: 257 }, (_, i) => codeAgent(`coder-${i}`)),
      ]
    ) {
      const f = fixture({ agents, defaultAgentId: agents[0]?.id });
      try {
        assertEquals(await call(f.owner, "discovery.describe"), {
          ok: false,
          code: "EXECUTOR_DISCOVERY_INVALID_OUTPUT",
        });
        assertEquals(f.owner.signal.aborted, true);
        assertEquals(f.cleanups, 1);
      } finally {
        await f.owner.close();
      }
    }
  });
});
