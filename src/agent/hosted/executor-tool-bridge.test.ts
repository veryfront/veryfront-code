import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool/types.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
  type ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import { createExecutorToolBroker } from "./executor-tool-bridge.ts";
import { createExecutorRemoteToolSources } from "./executor-tool-remote-facade.ts";
import { ExecutorAgentError } from "./executor-agent-schema.ts";
import { EXECUTOR_MAX_FRAME_BYTES } from "#veryfront/agent/executor/protocol.ts";
import {
  executorToolBytes,
  throwExecutorToolFailure,
} from "#veryfront/agent/hosted/executor-tool-schema.ts";

const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };
const definition: ToolDefinition = {
  name: "lookup",
  description: "Synthetic lookup",
  parameters: { type: "object" },
};
const call = { sourceId: "source-test", toolName: "lookup", args: {} };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fixture(
  sourceOverrides: Partial<RemoteToolSource> = {},
  overrides: Partial<Parameters<typeof createExecutorToolBroker>[0]> = {},
  context: ToolExecutionContext = { projectId: "project-test" },
  capabilityOverrides: { retired?: Promise<void> } = {},
) {
  const lifetime = new AbortController();
  const source: RemoteToolSource = {
    id: "source-test",
    async listTools() {
      return [definition];
    },
    async executeTool() {
      return { ok: true };
    },
    ...sourceOverrides,
  };
  const sources = new Map([[source.id, {
    source,
    allowedToolNames: new Set(["lookup"]),
    context,
    ...capabilityOverrides,
  }]]);
  const operations = createExecutorToolBroker({
    scope: { binding, signal: lifetime.signal, assertActive() {} },
    sources,
    maxCalls: 32,
    maxConcurrent: 2,
    ...overrides,
  });
  const stream = (
    name: string,
    input: JsonValue,
    context: ExecutorOperationContext = {
      binding,
      signal: new AbortController().signal,
      deadline: Date.now() + 10_000,
    },
  ) => {
    const operation = operations.get(name)!;
    assert(operation.mode === "stream");
    return operation.handle(input, context)[Symbol.asyncIterator]();
  };
  return { operations, stream, source, sources, lifetime };
}

async function collect(iterator: AsyncIterator<JsonValue>) {
  const values: JsonValue[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return values;
    values.push(next.value);
  }
}

function pair(operations: ReadonlyMap<string, ExecutorOperation>, maxConcurrentCalls = 32) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const caller = createExecutorChannel({
    binding,
    maxConcurrentCalls,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    maxConcurrentCalls,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  return {
    caller,
    async close() {
      caller.close();
      await broker.closed;
    },
  };
}

describe("executor tool bridge", () => {
  it("requires an own data property to grant project context", async () => {
    let executions = 0;
    let grantReads = 0;
    const source: RemoteToolSource = {
      id: call.sourceId,
      async listTools() {
        return [definition];
      },
      async executeTool() {
        executions++;
        return null;
      },
    };
    const capability = Object.assign(Object.create({ projectContext: "skill" }), {
      source,
      allowedToolNames: new Set(["lookup"]),
      context: {},
    });
    const sources = new Map([[source.id, capability]]);
    const f = fixture({}, { sources });
    assertEquals(
      await collect(f.stream("tool.execute", {
        ...call,
        projectContext: { activeSkillId: "forged" },
      })),
      [{ type: "failure" }],
    );
    assertEquals(executions, 0);
    Object.defineProperty(capability, "projectContext", {
      get() {
        grantReads++;
        return "skill";
      },
    });
    assertThrows(() => fixture({}, { sources }), TypeError);
    assertEquals(grantReads, 0);
  });

  it("rejects caller skill context for ordinary host capabilities and retains host-owned context", async () => {
    const observed: ToolExecutionContext[] = [];
    const trusted = { activeSkillId: "host-skill", projectId: "host-project" };
    const f = fixture(
      {
        async executeTool(_name, _args, context) {
          observed.push(context!);
          return null;
        },
      },
      {},
      trusted,
    );
    const forged: JsonValue[] = [{}, { activeSkillId: "forged-skill" }];
    for (const projectContext of forged) {
      assertEquals(await collect(f.stream("tool.execute", { ...call, projectContext })), [
        { type: "failure" },
      ]);
    }
    assertEquals(observed.length, 0);
    const channels = pair(f.operations);
    try {
      const [facade] = await createExecutorRemoteToolSources({ channel: channels.caller });
      assert(facade);
      await facade.executeTool("lookup", {}, { activeSkillId: "ignored-caller-skill" });
      assertEquals(observed.length, 1);
      assertEquals(observed[0]!.activeSkillId, "host-skill");
      assertEquals(observed[0]!.projectId, "host-project");
    } finally {
      await channels.close();
    }
  });

  it("rejects extra authority inside project context before executing an opted-in capability", async () => {
    let executions = 0;
    const source: RemoteToolSource = {
      id: call.sourceId,
      async listTools() {
        return [definition];
      },
      async executeTool() {
        executions++;
        return null;
      },
    };
    const f = fixture({}, {
      sources: new Map([[source.id, {
        source,
        allowedToolNames: new Set(["lookup"]),
        context: {},
        projectContext: "skill",
      }]]),
    });
    const forged: JsonValue[] = [
      { authToken: "<TOKEN>" },
      { userId: "forged-user" },
      { activeSkillToolAvailability: { authToken: "<TOKEN>" } },
      { activeSkillToolAvailability: { scripts: ["../outside.ts"] } },
    ];
    for (const projectContext of forged) {
      assertEquals(await collect(f.stream("tool.execute", { ...call, projectContext })), [
        { type: "failure" },
      ]);
    }
    assertEquals(executions, 0);
  });

  it("completes void tools as null and preserves other falsy results without replay", async () => {
    for (const result of [undefined, null, false, 0, ""]) {
      let executions = 0;
      const f = fixture({
        executeTool: () => {
          executions++;
          return Promise.resolve(result);
        },
      });
      const channels = pair(f.operations);
      try {
        const [facade] = await createExecutorRemoteToolSources({ channel: channels.caller });
        assert(facade);
        assertEquals(await facade.executeTool("lookup", {}), result === undefined ? null : result);
        assertEquals(executions, 1);
      } finally {
        await channels.close();
      }
    }
  });

  it("clears omitted caller correlation for listing and execution without mutating broker context", async () => {
    const observed: ToolExecutionContext[] = [];
    const trusted: ToolExecutionContext = {
      projectId: "project-test",
      toolCallId: "stale-call",
      progressToken: "stale-progress",
    };
    async function observe(context?: ToolExecutionContext) {
      assert(context);
      observed.push(context);
      await context.publishDataEvent!({
        type: "progress",
        data: {
          toolCallId: context.toolCallId ?? null,
          progressToken: context.progressToken ?? null,
        },
      });
    }
    const f = fixture(
      {
        async listTools(context) {
          await observe(context);
          return [definition];
        },
        async executeTool(_name, _args, context) {
          await observe(context);
          return null;
        },
      },
      {},
      trusted,
    );
    const channels = pair(f.operations);
    try {
      const [facade] = await createExecutorRemoteToolSources({ channel: channels.caller });
      assert(facade);
      for (const correlation of [{}, { toolCallId: "current-call" }, { progressToken: 0 }]) {
        for (const mode of ["list", "execute"]) {
          const progress: unknown[] = [];
          const context = {
            ...correlation,
            publishDataEvent(event: unknown) {
              progress.push(event);
            },
          };
          if (mode === "list") await facade.listTools(context);
          else await facade.executeTool("lookup", {}, context);
          const actual = observed.at(-1)!;
          assertEquals(actual.toolCallId, correlation.toolCallId);
          assertEquals(actual.progressToken, correlation.progressToken);
          assertEquals(actual.projectId, "project-test");
          assertEquals(progress, [{
            type: "progress",
            data: {
              toolCallId: correlation.toolCallId ?? null,
              progressToken: correlation.progressToken ?? null,
            },
          }]);
        }
      }
      assertEquals(trusted.toolCallId, "stale-call");
      assertEquals(trusted.progressToken, "stale-progress");
    } finally {
      await channels.close();
    }
  });

  it("forwards listing correlation and progress while retaining broker authority", async () => {
    const observed: ToolExecutionContext[] = [];
    const f = fixture(
      {
        async listTools(context) {
          observed.push(context!);
          await context!.publishDataEvent!({
            type: "progress",
            data: { toolCallId: context!.toolCallId, progressToken: context!.progressToken },
          });
          return [definition];
        },
      },
      {},
      {
        projectId: "project-test",
        toolCallId: "stale-call",
        progressToken: "stale-progress",
      },
    );
    const channels = pair(f.operations);
    try {
      const [facade] = await createExecutorRemoteToolSources({ channel: channels.caller });
      assert(facade);
      const progress: unknown[] = [];
      assertEquals(
        await facade.listTools({
          projectId: "substituted",
          authToken: "<TOKEN>",
          toolCallId: "list-call",
          progressToken: 0,
          publishDataEvent(event) {
            progress.push(event);
          },
        }),
        [definition],
      );
      assertEquals(observed[0]!.toolCallId, "list-call");
      assertEquals(observed[0]!.progressToken, 0);
      assertEquals(observed[0]!.projectId, "project-test");
      assertEquals(observed[0]!.authToken, undefined);
      assertEquals(progress, [{
        type: "progress",
        data: { toolCallId: "list-call", progressToken: 0 },
      }]);
    } finally {
      await channels.close();
    }
  });

  it("keeps source receivers and broker authority while forwarding local progress", async () => {
    const observed: ToolExecutionContext[] = [];
    const source: RemoteToolSource & { executions: number } = {
      id: "source-test",
      executions: 0,
      async listTools(context) {
        assertEquals(this.id, "source-test");
        observed.push(context!);
        return [definition];
      },
      async executeTool(name, args, context) {
        this.executions++;
        assertEquals(name, "lookup");
        observed.push(context!);
        await context!.publishDataEvent!({ type: "progress", data: args });
        return { executions: this.executions };
      },
    };
    let persisted = 0;
    const trusted: ToolExecutionContext = {
      projectId: "project-test",
      runId: "run-test",
      activeSkillId: "skill-test",
      async publishDataEvent() {
        assertEquals(this, trusted);
        persisted++;
      },
    };
    const channels = pair(createExecutorToolBroker({
      scope: { binding, signal: new AbortController().signal, assertActive() {} },
      sources: new Map([[source.id, {
        source,
        allowedToolNames: new Set(["lookup"]),
        context: trusted,
      }]]),
      maxCalls: 4,
      maxConcurrent: 1,
    }));
    try {
      const [facade] = await createExecutorRemoteToolSources({ channel: channels.caller });
      assert(facade);
      assertEquals(await facade.listTools(), [definition]);
      const progress: unknown[] = [];
      assertEquals(
        await facade.executeTool("lookup", { query: "synthetic" }, {
          projectId: "substituted",
          runId: "substituted",
          activeSkillId: "substituted",
          authToken: "<TOKEN>",
          arbitrary: "substituted",
          toolCallId: "call-test",
          progressToken: 2,
          publishDataEvent(event) {
            assertEquals(persisted, 1);
            progress.push(event);
          },
        }),
        { executions: 1 },
      );
      assertEquals(progress, [{ type: "progress", data: { query: "synthetic" } }]);
      assertEquals(observed.map((ctx) => [ctx.projectId, ctx.runId, ctx.activeSkillId]), [
        ["project-test", "run-test", "skill-test"],
        ["project-test", "run-test", "skill-test"],
      ]);
      assertEquals(observed[1]!.toolCallId, "call-test");
      assertEquals(observed[1]!.progressToken, 2);
      assertEquals(observed[1]!.authToken, undefined);
      assertEquals(observed[1]!.arbitrary, undefined);
      await assertRejects(() => facade.executeTool("other", {}));
      assertEquals(source.executions, 1);
      assert(persisted === 1);
    } finally {
      await channels.close();
    }
  });

  it("rejects binding, source, name, and authority substitutions before invoking a source", async () => {
    let dispatches = 0;
    const f = fixture({
      async listTools() {
        dispatches++;
        return [];
      },
      async executeTool() {
        dispatches++;
        return null;
      },
    });
    for (
      const changed of [
        { ...binding, generation: 2 },
        { ...binding, allocationId: "other" },
        { ...binding, invocationId: "other" },
      ]
    ) {
      await assertRejects(() =>
        f.stream("tool.execute", call, {
          binding: changed,
          signal: new AbortController().signal,
          deadline: Date.now() + 1000,
        }).next()
      );
    }
    for (
      const input of [
        { ...call, sourceId: "other" },
        { ...call, toolName: "other" },
        ...[
          "url",
          "headers",
          "authToken",
          "projectId",
          "userId",
          "runId",
          "context",
          "binding",
          "activeSkillId",
        ]
          .map((key) => ({ ...call, [key]: "substituted" })),
      ]
    ) assertEquals(await collect(f.stream("tool.execute", input)), [{ type: "failure" }]);
    assertEquals(await collect(f.stream("tool.list", { sourceId: "source-test", context: {} })), [{
      type: "failure",
    }]);
    assertEquals(await collect(f.stream("tool.sources", { url: "https://example.test" })), [{
      type: "failure",
    }]);
    assertEquals(dispatches, 0);
  });

  it("captures bindings, allowlists, methods, and authoritative context at construction", async () => {
    const ownerBinding = { ...binding };
    const trusted = { projectId: "project-test" };
    const f = fixture({
      async executeTool(_name, _args, context) {
        return context!.projectId;
      },
    }, {
      scope: { binding: ownerBinding, signal: new AbortController().signal, assertActive() {} },
    }, trusted);
    trusted.projectId = "changed";
    ownerBinding.generation = 2;
    f.sources.get("source-test")!.allowedToolNames.add("other");
    f.source.executeTool = async () => "changed";
    f.sources.clear();
    assertEquals(await collect(f.stream("tool.execute", call)), [{
      type: "result",
      result: "project-test",
    }]);
    assertEquals(await collect(f.stream("tool.execute", { ...call, toolName: "other" })), [{
      type: "failure",
    }]);
  });

  it("counts admitted failures, source enumeration, and listing against one invocation budget", async () => {
    const f = fixture({}, { maxCalls: 3 });
    assertEquals(await collect(f.stream("tool.execute", { ...call, toolName: "other" })), [{
      type: "failure",
    }]);
    await collect(f.stream("tool.sources", {}));
    await collect(f.stream("tool.list", { sourceId: "source-test" }));
    assertEquals(await collect(f.stream("tool.execute", call)), [{
      type: "failure",
      code: "RESOURCE_LIMIT_EXCEEDED",
    }]);
    for (const value of [0, -1, 1.5, Infinity, NaN]) {
      assertThrows(() => fixture({}, { maxCalls: value }), TypeError);
      assertThrows(() => fixture({}, { maxConcurrent: value }), TypeError);
    }
  });

  it("releases admission after a confirmed terminal remote failure without waiting for retirement", async () => {
    const retired = Promise.withResolvers<void>();
    let executions = 0;
    const f = fixture(
      {
        async executeTool() {
          executions++;
          if (executions === 1) {
            throwExecutorToolFailure({ type: "failure", code: "PERMISSION_DENIED" }, true);
          }
          return { recovered: true };
        },
      },
      { maxConcurrent: 1 },
      {},
      { retired: retired.promise },
    );

    assertEquals(f.sources.get("source-test")!.retired, retired.promise);
    const first = await collect(f.stream("tool.execute", call));
    assertEquals(first, [{
      type: "failure",
      code: "PERMISSION_DENIED",
    }]);
    const second = await collect(f.stream("tool.execute", call));
    assertEquals(second, [{
      type: "result",
      result: { recovered: true },
    }]);
    assertEquals(executions, 2);
    retired.resolve();
  });

  it("streams a catalog larger than one frame and preserves schema property names", async () => {
    const parameters = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"number"},"headers":{"type":"object"}}}',
    );
    const definitions: ToolDefinition[] = Array.from({ length: 12 }, (_, index) => ({
      name: `tool-${index}`,
      description: "x".repeat(100_000),
      parameters,
      title: undefined,
      annotations: undefined,
    }));
    const source: RemoteToolSource = {
      id: "catalog-test",
      async listTools() {
        return definitions;
      },
      async executeTool() {
        return null;
      },
    };
    const f = fixture({}, {
      sources: new Map([[source.id, {
        source,
        context: {},
        allowedToolNames: new Set(definitions.map((d) => d.name)),
      }]]),
    });
    const channels = pair(f.operations);
    try {
      const [facade] = await createExecutorRemoteToolSources({ channel: channels.caller });
      const listed = await facade!.listTools();
      assert(JSON.stringify(listed).length > EXECUTOR_MAX_FRAME_BYTES);
      assertEquals(listed.length, definitions.length);
      assertEquals(listed[0]!.parameters, parameters);
      assert(Object.hasOwn(listed[0]!.parameters.properties!, "__proto__"));
    } finally {
      await channels.close();
    }
  });

  it("bounds listed tool counts, metadata bytes, and disallowed descriptors", async () => {
    for (
      const [source, limits] of [
        {
          source: {
            async listTools() {
              return [definition, { ...definition, name: "unlisted" }];
            },
          },
          limits: { maxToolsPerSource: 1 },
        },
        {
          source: {
            async listTools() {
              return [{ ...definition, description: "x".repeat(1000) }];
            },
          },
          limits: { maxMetadataBytes: 100 },
        },
        {
          source: {
            async listTools() {
              return [{ ...definition, name: "unlisted", description: "x".repeat(1000) }];
            },
          },
          limits: { maxDescriptorBytes: 100 },
        },
        {
          source: {
            async listTools() {
              return [definition, definition];
            },
          },
          limits: {},
        },
      ].map(({ source, limits }) => [source, limits] as const)
    ) {
      const f = fixture(source, { limits });
      const frames = await collect(f.stream("tool.list", { sourceId: "source-test" }));
      assertEquals((frames.at(-1) as { type: string }).type, "failure");
      assert(!frames.some((frame) => (frame as { type: string }).type === "complete"));
    }
    const f = fixture({
      async listTools() {
        return [definition, { ...definition, name: "unlisted" }];
      },
    });
    const frames = await collect(f.stream("tool.list", { sourceId: "source-test" }));
    assertEquals<unknown>(frames, [{ type: "tool", definition }, { type: "complete" }]);
    assert(executorToolBytes(frames[0]!) < EXECUTOR_MAX_FRAME_BYTES);
  });

  it("snapshots the bounded catalog before yielding and holds admission through unread descriptors", async () => {
    const definitions = [definition, { ...definition, name: "second" }];
    const source: RemoteToolSource = {
      id: "source-test",
      async listTools() {
        return definitions;
      },
      async executeTool() {
        return null;
      },
    };
    const f = fixture({}, {
      maxConcurrent: 1,
      sources: new Map([[source.id, {
        source,
        context: {},
        allowedToolNames: new Set(["lookup", "second"]),
      }]]),
    });
    const iterator = f.stream("tool.list", { sourceId: source.id });
    assertEquals<unknown>((await iterator.next()).value, { type: "tool", definition });
    definitions[1]!.name = "changed";
    definitions.push({ ...definition, name: "late" });
    assertEquals(await collect(f.stream("tool.sources", {})), [{
      type: "failure",
      code: "RESOURCE_LIMIT_EXCEEDED",
    }]);
    assertEquals<unknown>(await collect(iterator), [{
      type: "tool",
      definition: { ...definition, name: "second" },
    }, { type: "complete" }]);
  });

  it("rejects excess source/name grants and charges aggregate metadata across requests", async () => {
    const source: RemoteToolSource = {
      id: "source-test",
      async listTools() {
        return [definition];
      },
      async executeTool() {
        return null;
      },
    };
    const capability = { source, context: {}, allowedToolNames: new Set(["lookup", "other"]) };
    assertThrows(() =>
      fixture({}, { sources: new Map([[source.id, capability]]), limits: { maxTotalTools: 1 } })
    );
    assertThrows(() => fixture({}, { sources: new Map([["mismatch", capability]]) }));
    assertThrows(() =>
      fixture({}, {
        sources: new Map([[source.id, capability], ["second", {
          ...capability,
          source: { ...source, id: "second" },
        }]]),
        limits: { maxSources: 1 },
      })
    );
    const f = fixture({}, { limits: { maxTotalTools: 1 } });
    await collect(f.stream("tool.list", { sourceId: source.id }));
    assertEquals(await collect(f.stream("tool.list", { sourceId: source.id })), [{
      type: "failure",
      code: "RESOURCE_LIMIT_EXCEEDED",
    }]);
    const enumeration = fixture({}, { limits: { maxMetadataBytes: 50 } });
    await collect(enumeration.stream("tool.sources", {}));
    assertEquals(await collect(enumeration.stream("tool.sources", {})), [{
      type: "failure",
      code: "RESOURCE_LIMIT_EXCEEDED",
    }]);
  });

  it("enforces every progress bound even when a source catches publication failure", async () => {
    for (
      const limits of [
        { maxProgressEvents: 1 },
        { maxProgressBytes: 80 },
        { maxProgressEventBytes: 20 },
        { maxQueuedProgressBytes: 20 },
      ]
    ) {
      let ctx: ToolExecutionContext | undefined;
      const f = fixture({
        async executeTool(_name, _args, context) {
          ctx = context;
          try {
            await ctx!.publishDataEvent!({ type: "progress", data: "synthetic" });
            await ctx!.publishDataEvent!({ type: "progress", data: "synthetic" });
          } catch { /* A source cannot turn publication failure into success. */ }
          return { ok: true };
        },
      }, { limits });
      const frames = await collect(f.stream("tool.execute", call));
      assertEquals((frames.at(-1) as { type: string }).type, "failure");
      assert(!frames.some((frame) => (frame as { type: string }).type === "result"));
      assertEquals(ctx!.abortSignal!.aborted, true);
    }
  });

  it("drains 48 cooperative progress events through the channel without overflowing", async () => {
    for (const mode of ["list", "execute"] as const) {
      let persisted = 0;
      const publish = async (context?: ToolExecutionContext) => {
        for (let index = 0; index < 48; index++) {
          await context!.publishDataEvent!({ type: "progress", data: index });
        }
      };
      const f = fixture(
        {
          async listTools(context) {
            await publish(context);
            return [definition];
          },
          async executeTool(_name, _args, context) {
            await publish(context);
            return 48;
          },
        },
        {},
        {
          publishDataEvent() {
            persisted++;
          },
        },
      );
      const channels = pair(f.operations);
      try {
        const [source] = await createExecutorRemoteToolSources({ channel: channels.caller });
        const progress: unknown[] = [];
        const context = {
          publishDataEvent(event: { type: string; data?: unknown }) {
            progress.push(event.data);
          },
        };
        if (mode === "list") assertEquals(await source!.listTools(context), [definition]);
        else assertEquals(await source!.executeTool("lookup", {}, context), 48);
        assertEquals(progress, Array.from({ length: 48 }, (_, index) => index));
        assertEquals(persisted, 48);
      } finally {
        await channels.close();
      }
    }
  });

  it("rejects held progress acknowledgements on abort and iterator return before joining source cleanup", async () => {
    for (const cancel of ["abort", "return"] as const) {
      const cleanup = Promise.withResolvers<void>();
      const controller = new AbortController();
      let acknowledged = false;
      let rejected = false;
      let cleaning = false;
      const f = fixture({
        async executeTool(_name, _args, context) {
          try {
            await context!.publishDataEvent!({ type: "progress" });
            acknowledged = true;
          } catch {
            rejected = true;
          } finally {
            cleaning = true;
            await cleanup.promise;
          }
          return null;
        },
      }, { maxConcurrent: 1 });
      const iterator = f.stream("tool.execute", call, {
        binding,
        signal: controller.signal,
        deadline: Date.now() + 10_000,
      });
      let returning: Promise<IteratorResult<JsonValue>> | undefined;
      try {
        assertEquals((await iterator.next()).value, {
          type: "progress",
          event: { type: "progress" },
        });
        await tick();
        assertEquals(acknowledged, false);
        assertEquals(cleaning, false);
        if (cancel === "abort") controller.abort();
        let returned = false;
        returning = iterator.return!().finally(() => {
          returned = true;
        });
        await tick();
        assertEquals(rejected, true);
        assertEquals(cleaning, true);
        assertEquals(returned, false);
        assertEquals(await collect(f.stream("tool.sources", {})), [{
          type: "failure",
          code: "RESOURCE_LIMIT_EXCEEDED",
        }]);
        cleanup.resolve();
        await returning;
        assertEquals((await collect(f.stream("tool.sources", {}))).length, 2);
      } finally {
        controller.abort();
        cleanup.resolve();
        await (returning ?? iterator.return!()).catch(() => {});
      }
    }
  });

  it("cancels producer acknowledgement while the original publisher remains pending", async () => {
    const persistence = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    let sourceSettled = false;
    const f = fixture(
      {
        async executeTool(_name, _args, context) {
          try {
            await context!.publishDataEvent!({ type: "progress" });
          } finally {
            sourceSettled = true;
          }
          return null;
        },
      },
      { maxConcurrent: 1 },
      {
        publishDataEvent() {
          started.resolve();
          return persistence.promise;
        },
      },
    );
    let settled = false;
    const result = f.stream("tool.execute", call, {
      binding,
      signal: controller.signal,
      deadline: Date.now() + 10_000,
    }).next().finally(() => {
      settled = true;
    });
    void result.catch(() => {});
    try {
      await started.promise;
      controller.abort();
      await tick();
      assertEquals(sourceSettled, true);
      assertEquals(settled, false);
      assertEquals(await collect(f.stream("tool.sources", {})), [{
        type: "failure",
        code: "RESOURCE_LIMIT_EXCEEDED",
      }]);
    } finally {
      controller.abort();
      persistence.resolve();
    }
    await assertRejects(() => result);
  });

  it("preserves progress order and snapshots when the trusted publisher mutates its event", async () => {
    const f = fixture(
      {
        async executeTool(_name, _args, context) {
          const first = context!.publishDataEvent!({ type: "progress", data: { value: 1 } });
          const second = context!.publishDataEvent!({ type: "progress", data: { value: 2 } });
          await Promise.all([first, second]);
          return null;
        },
      },
      {},
      {
        async publishDataEvent(event) {
          if ((event.data as { value: number }).value === 1) await tick();
          (event.data as { value: number }).value = 100;
        },
      },
    );
    assertEquals(await collect(f.stream("tool.execute", call)), [
      { type: "progress", event: { type: "progress", data: { value: 1 } } },
      { type: "progress", event: { type: "progress", data: { value: 2 } } },
      { type: "result", result: null },
    ]);
  });

  it("joins trusted publisher rejection during metadata and execute before emitting one failure", async () => {
    for (const mode of ["list", "execute"] as const) {
      const publish = async (context?: ToolExecutionContext) => {
        void context!.publishDataEvent!({ type: "progress" });
        return [];
      };
      const f = fixture(
        {
          listTools: publish,
          executeTool: (_name, _args, context) => publish(context),
        },
        {},
        {
          async publishDataEvent() {
            await tick();
            throw new ExecutorAgentError("DURABLE_RUN_EVENT_PERSISTENCE_FAILED");
          },
        },
      );
      assertEquals(
        await collect(
          f.stream(`tool.${mode}`, mode === "list" ? { sourceId: "source-test" } : call),
        ),
        [{ type: "failure", code: "DURABLE_RUN_EVENT_PERSISTENCE_FAILED" }],
      );
    }
  });

  it("holds admission through delayed listing and execution after call cancellation", async () => {
    for (const mode of ["list", "execute"] as const) {
      const done = Promise.withResolvers<never[]>();
      const started = Promise.withResolvers<void>();
      let signal: AbortSignal | undefined;
      const invoke = (context?: ToolExecutionContext) => {
        signal = context!.abortSignal;
        started.resolve();
        return done.promise;
      };
      const f = fixture({
        listTools: invoke,
        executeTool: (_name, _args, context) => invoke(context),
      }, { maxConcurrent: 1 });
      const controller = new AbortController();
      const iterator = f.stream(
        `tool.${mode}`,
        mode === "list" ? { sourceId: "source-test" } : call,
        {
          binding,
          signal: controller.signal,
          deadline: Date.now() + 10_000,
        },
      );
      let settled = false;
      const result = iterator.next().finally(() => {
        settled = true;
      });
      void result.catch(() => {});
      await started.promise;
      controller.abort();
      await tick();
      assertEquals(signal?.aborted, true);
      assertEquals(settled, false);
      assertEquals(await collect(f.stream("tool.sources", {})), [{
        type: "failure",
        code: "RESOURCE_LIMIT_EXCEEDED",
      }]);
      done.resolve([]);
      await assertRejects(() => result);
      assertEquals((await collect(f.stream("tool.sources", {}))).length, 2);
    }
  });

  it("keeps channel cancellation acknowledgement pending until the original source settles", async () => {
    const done = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const f = fixture({
      async executeTool() {
        started.resolve();
        await done.promise;
        return "late result";
      },
    });
    const channels = pair(f.operations, 1);
    const controller = new AbortController();
    const iterator = channels.caller.stream("tool.execute", call, { signal: controller.signal });
    const first = iterator.next();
    void first.catch(() => {});
    let cancellation: Promise<IteratorResult<JsonValue>> | undefined;
    try {
      await started.promise;
      controller.abort();
      await assertRejects(() => first);
      let released = false;
      cancellation = iterator.return!().finally(() => {
        released = true;
      });
      await tick();
      assertEquals(released, false);
      assertThrows(
        () => channels.caller.stream("tool.sources", {}),
        Error,
        "concurrent call limit",
      );
      done.resolve();
      await cancellation;
      assertEquals(await collect(channels.caller.stream("tool.sources", {})), [
        { type: "source", sourceId: "source-test" },
        { type: "complete" },
      ]);
    } finally {
      done.resolve();
      await cancellation?.catch(() => {});
      await channels.close();
    }
  });

  it("joins ignored publisher promises before progress, completion, or cancellation release", async () => {
    for (const cancel of [false, true]) {
      const persisted = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      const publisher = {
        async publishDataEvent() {
          started.resolve();
          await persisted.promise;
        },
      };
      const f = fixture(
        {
          async executeTool(_name, _args, context) {
            void context!.publishDataEvent!({ type: "progress", value: 1 });
            return { ok: true };
          },
        },
        { maxConcurrent: 1 },
        publisher,
      );
      const iterator = f.stream("tool.execute", call);
      let settled = false;
      const result = iterator.next().finally(() => {
        settled = true;
      });
      void result.catch(() => {});
      await started.promise;
      if (cancel) f.lifetime.abort();
      await tick();
      assertEquals(settled, false);
      if (!cancel) {
        assertEquals(await collect(f.stream("tool.sources", {})), [{
          type: "failure",
          code: "RESOURCE_LIMIT_EXCEEDED",
        }]);
      }
      persisted.resolve();
      if (cancel) await assertRejects(() => result);
      else {
        assertEquals((await result).value, {
          type: "progress",
          event: { type: "progress", value: 1 },
        });
        assertEquals(await collect(iterator), [{ type: "result", result: { ok: true } }]);
      }
    }
  });

  it("aborts on progress overflow and holds original publisher and source work until settled", async () => {
    const persistence = Promise.withResolvers<void>();
    const execution = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let context: ToolExecutionContext | undefined;
    let publisherCalls = 0;
    const f = fixture(
      {
        async executeTool(_name, _args, ctx) {
          context = ctx;
          void ctx!.publishDataEvent!({ type: "progress", value: 1 });
          await started.promise;
          try {
            ctx!.publishDataEvent!({ type: "progress", value: 2 });
          } catch { /* Producer ignores overflow. */ }
          await execution.promise;
          return null;
        },
      },
      { maxConcurrent: 1, limits: { maxQueuedProgress: 1 } },
      {
        async publishDataEvent() {
          publisherCalls++;
          started.resolve();
          await persistence.promise;
        },
      },
    );
    let settled = false;
    const result = collect(f.stream("tool.execute", call)).finally(() => {
      settled = true;
    });
    await started.promise;
    await tick();
    assertEquals(context!.abortSignal!.aborted, true);
    assertEquals(settled, false);
    assertThrows(() => context!.publishDataEvent!({ type: "progress" }));
    execution.resolve();
    await tick();
    assertEquals(settled, false);
    assertEquals(await collect(f.stream("tool.sources", {})), [{
      type: "failure",
      code: "RESOURCE_LIMIT_EXCEEDED",
    }]);
    persistence.resolve();
    assertEquals(await result, [{ type: "failure", code: "RESOURCE_LIMIT_EXCEEDED" }]);
    assertEquals(publisherCalls, 1);
  });

  it("starts the trusted publisher for an accepted event before a synchronous later overflow", async () => {
    const persistence = Promise.withResolvers<void>();
    let publishers = 0;
    const f = fixture(
      {
        async executeTool(_name, _args, context) {
          void context!.publishDataEvent!({ type: "progress" });
          try {
            context!.publishDataEvent!({ type: "progress" });
          } catch { /* Synthetic producer. */ }
          return null;
        },
      },
      { limits: { maxQueuedProgress: 1 } },
      {
        publishDataEvent() {
          publishers++;
          return persistence.promise;
        },
      },
    );
    let settled = false;
    const result = collect(f.stream("tool.execute", call)).finally(() => {
      settled = true;
    });
    try {
      await tick();
      assertEquals(publishers, 1);
      assertEquals(settled, false);
    } finally {
      persistence.resolve();
    }
    assertEquals(await result, [{ type: "failure", code: "RESOURCE_LIMIT_EXCEEDED" }]);
  });

  it("rechecks owner authority after deferred work and rejects late publisher use", async () => {
    let active = true;
    const done = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    let ctx: ToolExecutionContext | undefined;
    const f = fixture({
      async executeTool(_name, _args, context) {
        ctx = context;
        started.resolve();
        return await done.promise;
      },
    }, {
      scope: {
        binding,
        signal: new AbortController().signal,
        assertActive() {
          if (!active) throw new Error("Synthetic revoked owner");
        },
      },
    });
    const result = collect(f.stream("tool.execute", call));
    void result.catch(() => {});
    await started.promise;
    active = false;
    done.resolve("late");
    await assertRejects(() => result);
    assertThrows(() => ctx!.publishDataEvent!({ type: "late" }));
    await assertRejects(() => f.stream("tool.sources", {}).next());
  });

  it("classifies only curated failures and never exposes unknown error details", async () => {
    for (
      const code of [
        "PERMISSION_DENIED",
        "DURABLE_RUN_EVENT_PERSISTENCE_FAILED",
        "RESOURCE_LIMIT_EXCEEDED",
      ] as const
    ) {
      const f = fixture({
        async executeTool() {
          throw new ExecutorAgentError(code);
        },
      });
      assertEquals(await collect(f.stream("tool.execute", call)), [{ type: "failure", code }]);
    }
    for (
      const error of [new Error("Synthetic private diagnostic"), {
        code: "UNKNOWN",
        context: "Synthetic private context",
      }]
    ) {
      const f = fixture({
        async executeTool() {
          throw error;
        },
      });
      assertEquals(await collect(f.stream("tool.execute", call)), [{ type: "failure" }]);
    }
    const f = fixture({
      async executeTool() {
        return { isError: true, data: "Synthetic tool result" };
      },
    });
    assertEquals(await collect(f.stream("tool.execute", call)), [{
      type: "result",
      result: { isError: true, data: "Synthetic tool result" },
    }]);
  });
});
