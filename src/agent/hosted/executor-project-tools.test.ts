import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool/factory.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { executorToolBytes } from "./executor-tool-schema.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorProjectToolOperations,
  createExecutorProjectToolSource,
  type ExecutorProjectToolContext,
} from "./executor-project-tools.ts";

const binding = {
  allocationId: "synthetic-allocation",
  generation: 1,
  invocationId: "synthetic-invocation",
};
const fixed = { agentId: "coder", runId: "synthetic-run", projectId: "synthetic-project" };
const projectContext: ExecutorProjectToolContext = {
  agentId: fixed.agentId,
  projectId: fixed.projectId,
  execution: { kind: "canonical", runId: fixed.runId },
};
const correlation = { toolCallId: "synthetic-call", progressToken: "synthetic-progress" };
const inputSchema = defineSchema((v) => v.object({ query: v.string() }))();

function pair(operations: ReadonlyMap<string, ExecutorOperation>) {
  const wire: string[] = [];
  const capture = () =>
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        wire.push(new TextDecoder().decode(chunk));
        controller.enqueue(chunk);
      },
    });
  const forward = capture();
  const backward = capture();
  const trusted = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const project = createExecutorChannel({
    binding,
    operations,
    transport: { readable: forward.readable, writable: backward.writable },
  });
  return {
    trusted,
    project,
    wire,
    async close() {
      trusted.close();
      await Promise.all([trusted.settled, project.settled]);
    },
  };
}

function fixture(
  execute: Tool["execute"] = (args) => Promise.resolve(args),
  overrides: Partial<Parameters<typeof createExecutorProjectToolOperations>[0]> = {},
) {
  const lifetime = new AbortController();
  let revoked = false;
  const assertActive = () => {
    if (revoked) throw new TypeError("Synthetic revoked scope");
  };
  const registered = tool({ id: "inspect", description: "Inspect a query", inputSchema, execute });
  const tools = new Map([["inspect", registered]]);
  const allowedToolNames = new Set(["inspect"]);
  const context = { ...projectContext };
  const operations = createExecutorProjectToolOperations({
    scope: { binding, signal: lifetime.signal, assertActive },
    context,
    tools,
    allowedToolNames,
    maxCalls: 32,
    maxConcurrent: 2,
    ...overrides,
  });
  const channels = pair(operations);
  return {
    ...channels,
    lifetime,
    context,
    tools,
    allowedToolNames,
    registered,
    operations,
    revoke() {
      revoked = true;
    },
    source(options: Partial<Parameters<typeof createExecutorProjectToolSource>[0]> = {}) {
      return createExecutorProjectToolSource({
        channel: channels.trusted,
        signal: lifetime.signal,
        context: { ...projectContext },
        allowedToolNames: new Set(["inspect"]),
        assertActive,
        ...options,
      });
    },
  };
}

describe("executor project tools", () => {
  it("preserves fixed user and project scope and only the current call's skill data", async () => {
    const scope = { ...projectContext, userId: "synthetic-user", projectSlug: "synthetic-slug" };
    const observed: ToolExecutionContext[] = [];
    const f = fixture(async (_args, context) => {
      assert(context);
      observed.push(context);
      return null;
    }, { context: scope });
    try {
      const source = await f.source({ context: scope });
      // Neither adapter may keep reading mutable installation authority.
      scope.userId = "changed-user";
      scope.projectSlug = "changed-slug";
      const active = {
        activeSkillId: "inspect-skill",
        activeSkillToolAvailability: {
          hasActiveSkill: true,
          references: ["references/guide.md", "resources/example.json", "assets/icon.svg"],
          scripts: ["scripts/inspect.ts"],
        },
      };
      const inactive = {
        activeSkillToolAvailability: { hasActiveSkill: false, references: [], scripts: [] },
      };
      const skillContexts: ToolExecutionContext[] = [active, inactive, {}];
      for (const current of skillContexts) {
        const context: ToolExecutionContext = { ...correlation, ...current };
        Object.defineProperty(context, "authToken", {
          enumerable: true,
          get() {
            throw new Error("Credentials must not be read");
          },
        });
        await source.executeTool("inspect", { query: "hello" }, context);
        const result = observed.at(-1)!;
        assertEquals(result.userId, "synthetic-user");
        assertEquals(result.projectSlug, "synthetic-slug");
        assertEquals(result.activeSkillId, current.activeSkillId);
        assertEquals(result.activeSkillToolAvailability, current.activeSkillToolAvailability);
        assert(!Object.hasOwn(result, "authToken"));
      }
      const before = f.wire.length;
      for (const key of ["userId", "projectSlug"]) {
        await assertRejects(() =>
          source.executeTool("inspect", { query: "hello" }, {
            ...correlation,
            [key]: "other",
          })
        );
        await assertRejects(() => source.listTools({ [key]: "other" }));
      }
      assertEquals(f.wire.length, before);
      assertEquals(observed.length, 3);
      assert(!f.wire.join("").includes("authToken"));
    } finally {
      await f.close();
    }
  });

  it("charges aliases, source frames and definitions to one metadata budget", async () => {
    for (const includeAliases of [false, true]) {
      const f = fixture();
      try {
        const list = f.operations.get("tool.list");
        assert(list?.mode === "stream");
        const frames = await Array.fromAsync(list.handle({ sourceId: "project" }, {
          binding,
          signal: f.lifetime.signal,
          deadline: Date.now() + 10_000,
        }));
        const definition = frames[0]!;
        const catalogBytes = executorToolBytes({ type: "source", sourceId: "project" }) +
          executorToolBytes(definition);
        const aliasBytes = executorToolBytes({ agentId: fixed.agentId, aliases: [] });
        const pending = f.source({
          limits: { maxMetadataBytes: catalogBytes + (includeAliases ? aliasBytes : 0) },
        });
        if (includeAliases) assertEquals((await (await pending).listTools()).length, 1);
        else await assertRejects(() => pending, TypeError);
      } finally {
        await f.close();
      }
    }
  });

  it("executes through the channel with only fixed identity and local call adapters", async () => {
    let executions = 0;
    const f = fixture(async (args, context) => {
      executions++;
      assert(context?.abortSignal instanceof AbortSignal);
      assertEquals(typeof context.publishDataEvent, "function");
      return {
        query: args.query,
        fields: Object.keys(context).sort(),
        agentId: context.agentId,
        runId: context.runId,
        runIdBindsToolAuthorization: context.runIdBindsToolAuthorization,
        projectId: context.projectId,
        toolCallId: context.toolCallId,
        progressToken: context.progressToken,
      };
    });
    try {
      assertEquals([...f.operations.keys()], [
        "tool.sources",
        "tool.list",
        "tool.execute",
        "project.tool-aliases",
      ]);
      const source = await f.source();
      assertEquals(source.id, "project");
      assertEquals((await source.listTools()).map((item) => item.name), ["inspect"]);
      const context: ToolExecutionContext = {
        ...fixed,
        ...correlation,
        authToken: "<TOKEN>",
        unrelatedPrivateField: "<REDACTED>",
      };
      Object.defineProperty(context, "privateGetter", {
        enumerable: true,
        get() {
          throw new Error("Private context read");
        },
      });
      assertEquals(await source.executeTool("inspect", { query: "hello" }, context), {
        query: "hello",
        fields: [
          "abortSignal",
          "agentId",
          "progressToken",
          "projectId",
          "publishDataEvent",
          "runId",
          "runIdBindsToolAuthorization",
          "toolCallId",
        ],
        ...fixed,
        ...correlation,
        runIdBindsToolAuthorization: true,
      });
      assertEquals(executions, 1);
      for (
        const marker of [
          "<TOKEN>",
          "<REDACTED>",
          "authToken",
          "unrelatedPrivateField",
          "privateGetter",
        ]
      ) {
        assert(!f.wire.join("").includes(marker));
      }
      await assertRejects(() => source.executeTool("inspect", { query: 7 }, correlation));
      assertEquals(executions, 1);
    } finally {
      await f.close();
    }
  });

  it("keeps ephemeral project tools unbound to control-plane run authority", async () => {
    const context: ExecutorProjectToolContext = {
      agentId: fixed.agentId,
      projectId: fixed.projectId,
      execution: { kind: "ephemeral" },
    };
    let executions = 0;
    const f = fixture(async (_args, call) => {
      executions++;
      assert(call);
      return {
        hasRunId: Object.hasOwn(call, "runId"),
        runIdBindsToolAuthorization: call.runIdBindsToolAuthorization,
        projectId: call.projectId,
      };
    }, { context });
    try {
      const source = await f.source({ context });
      assertEquals(await source.executeTool("inspect", { query: "hello" }, correlation), {
        hasRunId: false,
        runIdBindsToolAuthorization: false,
        projectId: fixed.projectId,
      });
      await assertRejects(() =>
        source.executeTool("inspect", { query: "hello" }, { ...correlation, runId: fixed.runId })
      );
      await assertRejects(() =>
        source.executeTool("inspect", { query: "hello" }, {
          ...correlation,
          runIdBindsToolAuthorization: true,
        })
      );
      assertEquals(executions, 1);
    } finally {
      await f.close();
    }
  });

  it("rejects conflicting explicit identities and missing or malformed call correlation before dispatch", async () => {
    let executions = 0;
    const f = fixture(async () => ++executions);
    try {
      const source = await f.source();
      const before = f.wire.length;
      for (const key of ["agentId", "runId", "projectId", "userId", "projectSlug"]) {
        await assertRejects(() =>
          source.executeTool("inspect", { query: "hello" }, { ...correlation, [key]: "other" })
        );
        await assertRejects(() => source.listTools({ [key]: "other" }));
      }
      for (
        const context of [undefined, {}, { toolCallId: "" }, { toolCallId: 1 }, {
          ...correlation,
          progressToken: {},
        }]
      ) {
        await assertRejects(() =>
          source.executeTool("inspect", { query: "hello" }, context as ToolExecutionContext)
        );
      }
      await assertRejects(() => source.executeTool("unknown", { query: "hello" }, correlation));
      assertEquals(f.wire.length, before);
      assertEquals(executions, 0);
    } finally {
      await f.close();
    }
  });

  it("filters owner-invisible and skill infrastructure tools and uses registered names", async () => {
    const make = (id: string, ownerAgentId?: string): Tool => ({
      ...tool({ id, description: "Synthetic tool", inputSchema, execute: (args) => args }),
      ownerAgentId,
    });
    const tools = new Map([
      ["registered", make("internal", "coder")],
      ["hidden", make("hidden", "other")],
      ["load_skill", make("load_skill")],
    ]);
    const allowedToolNames = new Set(["registered", "hidden", "load_skill"]);
    const f = fixture(undefined, { tools, allowedToolNames });
    try {
      const source = await f.source({ allowedToolNames });
      assertEquals((await source.listTools()).map((item) => item.name), ["registered"]);
      assertEquals(await source.executeTool("registered", { query: "hello" }, correlation), {
        query: "hello",
      });
      for (const name of ["hidden", "load_skill", "internal"]) {
        await assertRejects(() => source.executeTool(name, { query: "hello" }, correlation));
      }
    } finally {
      await f.close();
    }
  });

  it("snapshots both construction contexts, grants, tool callbacks and detached descriptors", async () => {
    const f = fixture();
    const context = { ...projectContext };
    const allowedToolNames = new Set(["inspect"]);
    try {
      const pending = f.source({ context, allowedToolNames });
      context.agentId = "other";
      allowedToolNames.clear();
      allowedToolNames.add("ungranted");
      f.context.projectId = "other";
      f.allowedToolNames.clear();
      f.tools.clear();
      f.registered.execute = async () => "mutated";
      f.registered.description = "mutated";
      const source = await pending;
      const first = await source.listTools();
      first[0]!.name = "mutated";
      first[0]!.parameters.type = "string";
      first.push({ name: "ungranted", description: "", parameters: {} });
      assertEquals((await source.listTools()).map((item) => item.name), ["inspect"]);
      assertEquals((await source.listTools())[0]!.parameters.type, "object");
      assertEquals(
        await source.executeTool("inspect", { query: "hello" }, { ...fixed, ...correlation }),
        { query: "hello" },
      );
      await assertRejects(() => source.executeTool("ungranted", {}, correlation));
    } finally {
      await f.close();
    }
  });

  it("retains owner aliases when a global tool has the same short name", async () => {
    const globalTool = tool({
      id: "inspect",
      description: "Global inspection",
      inputSchema,
      execute: () => "global",
    });
    const owned = tool({
      id: "coder--inspect",
      description: "Owned inspection",
      inputSchema,
      execute: () => "owned",
    });
    owned.ownerAgentId = "coder";
    owned.shortName = "inspect";
    const allowedToolNames = new Set(["inspect", "coder--inspect"]);
    const f = fixture(undefined, {
      tools: new Map([["inspect", globalTool], ["coder--inspect", owned]]),
      allowedToolNames,
    });
    try {
      const source = await f.source({ allowedToolNames });
      assertEquals(source.aliases, [{ name: "coder--inspect", shortName: "inspect" }]);
      assertEquals(
        await source.executeTool("coder--inspect", { query: "hello" }, correlation),
        "owned",
      );
      assertEquals(await source.executeTool("inspect", { query: "hello" }, correlation), "global");
    } finally {
      await f.close();
    }
  });

  it("rejects extra or malformed construction context on either adapter", async () => {
    const f = fixture();
    try {
      for (
        const context of [
          { ...projectContext, authToken: "<TOKEN>" },
          { ...projectContext, optionalRequirement: true },
          { ...projectContext, agentId: "" },
          { ...projectContext, execution: { kind: "canonical", runId: 1 } },
          { ...projectContext, execution: { kind: "canonical" } },
          { ...projectContext, execution: { kind: "ephemeral", runId: fixed.runId } },
          { ...projectContext, projectId: "x".repeat(257) },
          { agentId: "coder", runId: "synthetic-run" },
        ]
      ) {
        assertThrows(() =>
          createExecutorProjectToolOperations({
            scope: { binding, signal: f.lifetime.signal, assertActive() {} },
            context: context as ExecutorProjectToolContext,
            tools: f.tools,
            allowedToolNames: f.allowedToolNames,
            maxCalls: 8,
            maxConcurrent: 1,
          })
        );
        await assertRejects(() => f.source({ context: context as ExecutorProjectToolContext }));
      }
    } finally {
      await f.close();
    }
  });

  it("rejects revoked authority before dispatch and before accepting a late result", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let active = true;
    let executions = 0;
    const f = fixture(async () => {
      executions++;
      started.resolve();
      await finish.promise;
      return "late";
    });
    try {
      const source = await f.source({
        assertActive() {
          if (!active) throw new TypeError("Revoked");
        },
      });
      const result = source.executeTool("inspect", { query: "hello" }, correlation);
      await started.promise;
      active = false;
      finish.resolve();
      await assertRejects(() => result);
      await assertRejects(() => source.executeTool("inspect", { query: "hello" }, correlation));
      await assertRejects(() => source.listTools());
      f.revoke();
      await assertRejects(() => f.source());
      assertEquals(executions, 1);
    } finally {
      finish.resolve();
      await f.close();
    }
  });

  it("does not expose privileged operations to the project peer", async () => {
    const f = fixture();
    try {
      await f.source();
      await assertRejects(() => f.project.request("model.prepare", {}));
      await assertRejects(() => f.project.request("runtime.prepare", {}));
    } finally {
      await f.close();
    }
  });

  for (
    const problem of ["extra source", "duplicate source", "malformed descriptor", "duplicate tool"]
  ) {
    it(`rejects ${problem} from a project peer`, async () => {
      const descriptor = {
        name: "inspect",
        description: "Synthetic",
        parameters: { type: "object" },
      };
      const stream = (frames: JsonValue[]): ExecutorOperation => ({
        mode: "stream",
        async *handle() {
          yield* frames;
        },
      });
      const sources: JsonValue[] = [{ type: "source", sourceId: "project" }];
      if (problem.endsWith("source")) {
        sources.push({
          type: "source",
          sourceId: problem === "extra source" ? "other" : "project",
        });
      }
      const tools: JsonValue[] = [{
        type: "tool",
        definition: problem === "malformed descriptor"
          ? { ...descriptor, parameters: [] }
          : descriptor,
      }];
      if (problem === "duplicate tool") tools.push(tools[0]!);
      const f = pair(
        new Map<string, ExecutorOperation>([
          ["tool.sources", stream([...sources, { type: "complete" }])],
          ["tool.list", stream([...tools, { type: "complete" }])],
          ["project.tool-aliases", {
            mode: "unary",
            handle: () => ({ agentId: fixed.agentId, aliases: [] }),
          }],
        ]),
      );
      try {
        await assertRejects(() =>
          createExecutorProjectToolSource({
            channel: f.trusted,
            signal: new AbortController().signal,
            context: projectContext,
            allowedToolNames: new Set(["inspect"]),
            assertActive() {},
          })
        );
      } finally {
        await f.close();
      }
    });
  }

  it("bounds progress and results without retrying a tool side effect", async () => {
    const progress: unknown[] = [];
    let executions = 0;
    const f = fixture(async (_args, context) => {
      executions++;
      await context!.publishDataEvent!({ type: "synthetic-progress", data: { percent: 50 } });
      return { oversized: "x".repeat(100) };
    }, { limits: { maxResultBytes: 32 } });
    try {
      const source = await f.source();
      await assertRejects(() =>
        source.executeTool("inspect", { query: "hello" }, {
          ...correlation,
          publishDataEvent: (event) => {
            progress.push(event);
          },
        })
      );
      assertEquals(progress, [{ type: "synthetic-progress", data: { percent: 50 } }]);
      assertEquals(executions, 1);
    } finally {
      await f.close();
    }
  });

  it("retains original tool work after cancellation until it actually settles", async () => {
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let executions = 0;
    const f = fixture(async (_args, context) => {
      executions++;
      context!.abortSignal!.addEventListener("abort", () => aborted.resolve(), { once: true });
      started.resolve();
      await finish.promise;
      return "late";
    });
    try {
      const source = await f.source();
      const controller = new AbortController();
      const result = source.executeTool("inspect", { query: "hello" }, {
        ...correlation,
        abortSignal: controller.signal,
      });
      const rejected = assertRejects(() => result);
      await started.promise;
      controller.abort();
      await aborted.promise;
      let retired = false;
      void f.project.settled.then(() => {
        retired = true;
      });
      f.trusted.close();
      await f.trusted.closed;
      assertEquals(retired, false, "A closed channel does not release the original project work");
      finish.resolve();
      await rejected;
      await Promise.all([f.trusted.settled, f.project.settled]);
      assertEquals(retired, true);
      assertEquals(executions, 1);
    } finally {
      finish.resolve();
      await f.close();
    }
  });
});
