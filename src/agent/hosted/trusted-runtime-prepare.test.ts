import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool/factory.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import {
  createExecutorProjectToolOperations,
  createExecutorProjectToolSource,
} from "#veryfront/agent/hosted/executor-project-tools.ts";
import { createTrustedRuntimePreparation } from "#veryfront/agent/hosted/trusted-runtime-prepare.ts";
import type {
  ExecutorRuntimeFacades,
  ExecutorRuntimePreparationGrant,
} from "#veryfront/agent/hosted/executor-runtime-prepare.ts";

const binding = {
  allocationId: "synthetic-allocation",
  invocationId: "synthetic-invocation",
  generation: 1,
};
const source = { type: "release", releaseId: "synthetic-release" } as const;
const modelId = "veryfront-cloud/openai/gpt-5.4";
const context = { agentId: "coder", runId: "synthetic-run", projectId: "synthetic-project" };
const definition = {
  id: "coder",
  name: "Coder",
  description: "Synthetic agent",
  instructions: "Synthetic source instructions",
  model: modelId,
  tools: ["inspect"],
  skills: false,
  maxSteps: 3,
};
const grant: ExecutorRuntimePreparationGrant = {
  agentId: "coder",
  defaultModelId: modelId,
  maxSteps: 3,
  models: new Map([[modelId, { maxOutputTokens: 200, providerToolNames: [] }]]),
  allowedToolNames: ["inspect"],
  hostToolFacadeIds: [],
  remoteToolSourceIds: ["project"],
  execution: {
    kind: "canonical",
    projectId: context.projectId,
    runId: context.runId,
    conversationId: "synthetic-conversation",
    messageId: "synthetic-message",
    providerReplay: "disabled",
  },
};

async function fixture(options: {
  ownedTool?: boolean;
  forgedAlias?: boolean;
  sourceTools?: string[];
  deniedTools?: string[];
  channelTimeoutMs?: number;
  describe?: Extract<ExecutorOperation, { mode: "unary" }>["handle"];
  facades?: Partial<ExecutorRuntimeFacades>;
  facadeInstance?: (facades: ExecutorRuntimeFacades) => ExecutorRuntimeFacades;
  closeProject?: () => Promise<void>;
} = {}) {
  const lifetime = new AbortController();
  const seen: unknown[] = [];
  const requested: unknown[] = [];
  let closed = 0;
  let cleaned = 0;
  const checkpoints: unknown[] = [];
  const toolName = options.forgedAlias
    ? "dangerous"
    : options.ownedTool
    ? "coder--inspect"
    : "inspect";
  const model = scriptedModel([
    {
      toolCalls: [{ id: "synthetic-call", name: toolName, input: { query: "authorized input" } }],
    },
    { text: "synthetic-private-model-output" },
  ]);
  const registered = tool({
    id: toolName,
    description: "Inspect a query",
    inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
    execute: (args, call) => {
      seen.push({
        args,
        context: call &&
          {
            agentId: call.agentId,
            runId: call.runId,
            projectId: call.projectId,
            toolCallId: call.toolCallId,
          },
      });
      return { ok: true };
    },
  });
  if (options.ownedTool) {
    registered.ownerAgentId = "coder";
    registered.shortName = "inspect";
  }
  const operations = new Map(createExecutorProjectToolOperations({
    scope: { binding, signal: lifetime.signal, assertActive() {} },
    context: {
      agentId: context.agentId,
      projectId: context.projectId,
      execution: { kind: "canonical", runId: context.runId },
    },
    tools: new Map([[toolName, registered]]),
    allowedToolNames: new Set([toolName]),
    maxCalls: 32,
    maxConcurrent: 2,
  }));
  if (options.forgedAlias) {
    operations.set("project.tool-aliases", {
      mode: "unary",
      handle: () => ({ agentId: "coder", aliases: [{ name: "dangerous", shortName: "inspect" }] }),
    });
  }
  operations.set("agent.describe", {
    mode: "unary",
    handle: options.describe ?? ((value) => {
      requested.push(value);
      return {
        ok: true,
        value: {
          source,
          definition: {
            ...definition,
            tools: options.sourceTools ?? [toolName],
            ...(options.deniedTools ? { deniedTools: options.deniedTools } : {}),
          },
        },
      };
    }),
  });
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const trusted = createExecutorChannel({
    binding,
    ...(options.channelTimeoutMs ? { defaultTimeoutMs: options.channelTimeoutMs } : {}),
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const project = createExecutorChannel({
    binding,
    operations,
    transport: { readable: forward.readable, writable: backward.writable },
  });
  const projectTools = await createExecutorProjectToolSource({
    channel: trusted,
    signal: lifetime.signal,
    context: {
      agentId: context.agentId,
      projectId: context.projectId,
      execution: { kind: "canonical", runId: context.runId },
    },
    allowedToolNames: new Set([toolName]),
    assertActive() {},
  });
  const facades: ExecutorRuntimeFacades = {
    resolveModelRuntime: () => model,
    hostTools: new Map(),
    remoteToolSources: new Map([["project", projectTools]]),
    projectSteering: {
      prepare: ({ definition }) => Promise.resolve({ agent: definition }),
      refresh: () => "synthetic-private-instructions",
    },
    publishParentRunEvents: () => Promise.resolve(),
    toolExposureCheckpoint: {
      persist: (checkpoint) => {
        checkpoints.push(checkpoint);
        return Promise.resolve();
      },
    },
    cleanup: () => {
      cleaned++;
      return Promise.resolve();
    },
    ...options.facades,
  };
  const owner = createTrustedRuntimePreparation({
    binding,
    source,
    channel: trusted,
    signal: lifetime.signal,
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    grant: {
      ...grant,
      allowedToolNames: options.forgedAlias ? ["inspect"] : [toolName],
      hostToolFacadeIds: options.forgedAlias ? ["host"] : [],
    },
    projectTools,
    facades: options.facadeInstance?.(facades) ?? facades,
    async closeProject() {
      assertEquals(this.channel, trusted, "Project cleanup retains its constructor receiver");
      closed++;
      trusted.close();
      await Promise.all([trusted.settled, project.settled]);
      await options.closeProject?.();
    },
  });
  const operationContext = {
    binding,
    signal: new AbortController().signal,
    deadline: Date.now() + 30_000,
  };
  return {
    owner,
    model,
    seen,
    requested,
    checkpoints,
    lifetime,
    trusted,
    project,
    get closed() {
      return closed;
    },
    get cleaned() {
      return cleaned;
    },
    async prepare(
      value: JsonValue = { agentId: "coder", instructions: "synthetic-private-instructions" },
    ) {
      const operation = owner.operations.get("runtime.prepare");
      assert(operation?.mode === "unary");
      return await operation.handle(value, operationContext);
    },
    async stream(handle: string) {
      const operation = owner.operations.get("agent.stream");
      assert(operation?.mode === "stream");
      return await Array.fromAsync(
        operation.handle({
          preparedRuntimeHandle: handle,
          messages: [{
            id: "input",
            role: "user",
            parts: [{ type: "text", text: "synthetic-private-conversation" }],
            timestamp: 1,
          }],
        }, operationContext),
      );
    },
  };
}

describe("trusted runtime preparation", () => {
  it("does not let peer aliases widen a trusted host-tool grant", async () => {
    let executed = 0;
    const dangerous = tool({
      id: "dangerous",
      description: "Synthetic host operation",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: () => {
        executed++;
        return { ok: true };
      },
    });
    const f = await fixture({
      forgedAlias: true,
      sourceTools: ["inspect"],
      facades: { hostTools: new Map([["host", { dangerous }]]) },
    });
    try {
      const prepared = await f.prepare() as {
        ok: boolean;
        value: { preparedRuntimeHandle: string };
      };
      if (prepared.ok) await f.stream(prepared.value.preparedRuntimeHandle);
      assertEquals(executed, 0, "Peer-owned aliases cannot authorize host capabilities");
    } finally {
      await f.owner.close();
    }
  });
  it("retains private facade class methods and their original receivers", async () => {
    let resolutions = 0;
    const f = await fixture({
      facadeInstance: (defaults) =>
        new class implements ExecutorRuntimeFacades {
          #defaults = defaults;
          hostTools = defaults.hostTools;
          remoteToolSources = defaults.remoteToolSources;
          projectSteering = defaults.projectSteering;
          toolExposureCheckpoint = defaults.toolExposureCheckpoint;
          publishParentRunEvents = defaults.publishParentRunEvents;
          resolveModelRuntime(id: string) {
            resolutions++;
            return this.#defaults.resolveModelRuntime(id);
          }
          cleanup() {
            return this.#defaults.cleanup();
          }
        }(),
    });
    try {
      assertEquals((await f.prepare() as { ok: boolean }).ok, true);
      assert(resolutions > 0);
    } finally {
      await f.owner.close();
    }
    assertEquals(f.cleaned, 1);
  });
  for (const denied of [false, true]) {
    it(`preserves owned tool short-name selectors and denials (${denied})`, async () => {
      const f = await fixture({
        ownedTool: true,
        sourceTools: denied ? ["coder--inspect"] : ["inspect"],
        deniedTools: denied ? ["inspect"] : undefined,
      });
      try {
        const prepared = await f.prepare() as {
          ok: boolean;
          value: { preparedRuntimeHandle: string };
        };
        assertEquals(prepared.ok, true);
        await f.stream(prepared.value.preparedRuntimeHandle);
        assertEquals(f.seen.length, denied ? 0 : 1);
      } finally {
        await f.owner.close();
      }
    });
  }
  it("respects a metadata channel timeout shorter than the preparation deadline", async () => {
    const f = await fixture({ channelTimeoutMs: 1000 });
    try {
      assertEquals((await f.prepare() as { ok: boolean }).ok, true);
    } finally {
      await f.owner.close();
    }
  });
  it("executes the existing canonical runtime using only metadata and remote project tools", async () => {
    const f = await fixture();
    try {
      assertEquals([...f.owner.operations.keys()], ["runtime.prepare", "agent.stream"]);
      const prepared = await f.prepare() as {
        ok: boolean;
        value: { preparedRuntimeHandle: string };
      };
      assertEquals(prepared.ok, true);
      const frames = await f.stream(prepared.value.preparedRuntimeHandle);
      assertEquals(frames[0], { type: "ready" });
      assertEquals(frames.at(-1), { type: "complete" });
      assertEquals(f.model.callCount, 2);
      assertEquals(f.seen, [{
        args: { query: "authorized input" },
        context: { ...context, toolCallId: "synthetic-call" },
      }]);
      assertEquals(f.requested, [{ agentId: "coder" }]);
      assert(f.model.systemPrompts()[0]?.includes("synthetic-private-instructions"));
      assert(JSON.stringify(frames).includes("synthetic-private-model-output"));
      assertEquals(
        f.checkpoints,
        [],
        "A fixed eager catalog does not emit deferred-loading checkpoints",
      );
    } finally {
      await f.owner.close();
      await f.owner.settled;
    }
    assertEquals(f.closed, 1);
    assertEquals(f.cleaned, 1);
  });
  for (const mismatch of ["agent", "source"]) {
    it(`rejects ${mismatch} metadata before private facade calls`, async () => {
      let privateCalls = 0;
      const f = await fixture({
        describe: () => ({
          ok: true,
          value: {
            source: mismatch === "source" ? { ...source, releaseId: "other" } : source,
            definition: { ...definition, id: mismatch === "agent" ? "other" : "coder" },
          },
        }),
        facades: {
          resolveModelRuntime: () => {
            privateCalls++;
            return undefined;
          },
        },
      });
      try {
        assertEquals(await f.prepare(), { ok: false, code: "EXECUTOR_RUNTIME_NOT_GRANTED" });
        assertEquals(privateCalls, 0);
      } finally {
        await f.owner.close();
      }
      assertEquals(f.closed, 1);
    });
  }
  it("requires canonical persistence capabilities without downgrading the invocation", async () => {
    const f = await fixture({ facades: { publishParentRunEvents: undefined } });
    try {
      assertEquals(await f.prepare(), {
        ok: false,
        code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
      });
      assertEquals(f.model.callCount, 0);
    } finally {
      await f.owner.close();
    }
  });
  it("retains original peer work when cancellation interrupts metadata discovery", async () => {
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const f = await fixture({
      describe: async (_value, context) => {
        context.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
        started.resolve();
        await finish.promise;
        return { ok: true, value: { source, definition } };
      },
    });
    try {
      const preparing = f.prepare();
      await started.promise;
      f.lifetime.abort();
      const closing = f.owner.close();
      let retired = false;
      void closing.then(() => {
        retired = true;
      });
      await aborted.promise;
      assertEquals(retired, false);
      finish.resolve();
      await preparing;
      await closing;
      await f.owner.settled;
      assertEquals(retired, true);
      assertEquals(f.model.callCount, 0);
    } finally {
      finish.resolve();
      await f.owner.close();
    }
    assertEquals(f.closed, 1);
  });
  it("surfaces project cleanup failure and invokes cleanup only once", async () => {
    const f = await fixture({
      closeProject: () => Promise.reject(new Error("Synthetic cleanup failure")),
    });
    await assertRejects(() => f.owner.close());
    await assertRejects(() => f.owner.settled);
    await assertRejects(() => f.owner.close());
    assertEquals(f.closed, 1);
  });
});
