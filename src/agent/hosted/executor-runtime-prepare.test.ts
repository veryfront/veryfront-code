import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { PERMISSION_DENIED } from "#veryfront/errors";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { parseRuntimeAgentMarkdownDefinition } from "#veryfront/agent/runtime/agent-definition.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "#veryfront/agent/runtime/agent-markdown-adapter.ts";
import type {
  HostToolDefinition,
  HostToolSet,
  RemoteToolSource,
  ToolDefinition,
} from "#veryfront/tool";
import { registerModelRuntimeResolverRevoker } from "#veryfront/agent/runtime/model-transport.ts";
import { assertPersistedModelOptions } from "./executor-model-dispatch-options.ts";
import { agent } from "#veryfront/agent/factory.ts";
import type { ProjectAgentRuntimeDiscovery } from "#veryfront/agent/project/agent-runtime.ts";
import { createExecutorDiscovery } from "./executor-discovery.ts";
import {
  createExecutorRuntimePreparation,
  type ExecutorRuntimeFacades,
  type ExecutorRuntimePreparationGrant,
} from "./executor-runtime-prepare.ts";
import {
  ExecutorRuntimePreparationError,
  getExecutorRuntimePrepareRequestSchema,
  parseRuntimePreparationData,
} from "#veryfront/agent/hosted/executor-runtime-prepare-schema.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorHostedChatRuntimeAgent } from "./executor-agent-bridge.ts";

const binding = {
  allocationId: "prepare-allocation",
  invocationId: "prepare-invocation",
  generation: 1,
};
const source = { type: "release", releaseId: "synthetic-release" } as const;
const modelId = "veryfront-cloud/openai/gpt-5.4";
const model: ModelRuntime = {
  modelId: "gpt-5.4",
  provider: "openai",
  specificationVersion: "v3",
  doGenerate: () => Promise.reject(new Error("Unexpected generate call")),
  doStream: () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", id: "text-1", delta: "Synthetic answer" });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 2 },
          });
          controller.close();
        },
      }),
    }),
};
function runtime(config: Partial<AgentConfig> = {}): ProjectAgentRuntimeDiscovery {
  const coder = agent({
    id: "coder",
    system: "Synthetic source instructions.",
    model: modelId,
    tools: true,
    ...config,
  });
  return {
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
}
const grant: ExecutorRuntimePreparationGrant = {
  agentId: "coder",
  defaultModelId: modelId,
  maxSteps: 5,
  models: new Map([[modelId, { maxOutputTokens: 200, providerToolNames: [] }]]),
  allowedToolNames: [],
  hostToolFacadeIds: [],
  remoteToolSourceIds: [],
  execution: { kind: "ephemeral", projectId: null },
};
function fixture(
  overrides: {
    grant?: ExecutorRuntimePreparationGrant | null;
    facades?: Partial<ExecutorRuntimeFacades>;
    facadeInstance?: ExecutorRuntimeFacades;
    config?: Partial<AgentConfig>;
    load?: () => Promise<ProjectAgentRuntimeDiscovery>;
  } = {},
) {
  let cleanups = 0;
  let discoveryCleanups = 0;
  const controller = new AbortController();
  const discovery = createExecutorDiscovery({
    binding,
    source,
    projectDir: "/synthetic-project",
    signal: controller.signal,
    backend: {
      load: overrides.load ?? (() => Promise.resolve(runtime(overrides.config))),
      cleanup: () => {
        discoveryCleanups++;
        return Promise.resolve();
      },
    },
  });
  const owner = createExecutorRuntimePreparation({
    binding,
    source,
    discovery,
    grant: overrides.grant === null ? undefined : overrides.grant ?? grant,
    facades: overrides.facadeInstance ?? {
      resolveModelRuntime: () => model,
      hostTools: new Map(),
      remoteToolSources: new Map(),
      cleanup: () => {
        cleanups++;
        return Promise.resolve();
      },
      ...overrides.facades,
    },
  });
  return {
    owner,
    discovery,
    controller,
    get cleanups() {
      return cleanups;
    },
    get discoveryCleanups() {
      return discoveryCleanups;
    },
  };
}
async function prepare(
  owner: ReturnType<typeof fixture>["owner"],
  value: JsonValue = { agentId: "coder" },
) {
  const operation = owner.operations.get("runtime.prepare");
  assert(operation?.mode === "unary");
  return await operation.handle(value, {
    binding,
    signal: new AbortController().signal,
    deadline: Date.now() + 30_000,
  });
}

describe("executor runtime preparation", () => {
  it("keeps skill references and scripts outside a loader-only grant after loading a skill", async () => {
    const visible: string[][] = [];
    const f = fixture({
      grant: { ...grant, allowedToolNames: ["load_skill"], hostToolFacadeIds: ["skills"] },
      facades: {
        hostTools: new Map([["skills", {
          load_skill: {
            description: "Synthetic loader",
            inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
            execute: () =>
              Promise.resolve({
                skillId: "example",
                instructions: "Synthetic instructions",
                references: ["references/example.md"],
                scripts: ["scripts/example.ts"],
              }),
          },
        }]]),
        projectSteering: {
          prepare: ({ definition }) =>
            Promise.resolve({
              agent: definition,
              initialSkills: [{
                id: "example",
                name: "example",
                description: "Synthetic",
                instructions: "Synthetic",
                allowedTools: [],
              }],
            }),
          refresh: () => "Synthetic instructions",
        },
        resolveModelRuntime: () => ({
          ...model,
          doStream(options) {
            visible.push(
              (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [],
            );
            return finishStream(visible.length === 1 ? "load_skill" : undefined, {
              skillId: "example",
            });
          },
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(visible, [["load_skill"], ["load_skill"]]);
    } finally {
      await f.owner.close();
    }
  });

  it("requires a locally installed grant even after discovery", async () => {
    const f = fixture({ grant: null });
    try {
      assertEquals(await prepare(f.owner), { ok: false, code: "EXECUTOR_RUNTIME_NOT_GRANTED" });
    } finally {
      await f.owner.close();
    }
  });

  it("rejects a model grant that would bypass the managed model resolver", () => {
    assertThrows(
      () =>
        fixture({
          grant: {
            ...grant,
            defaultModelId: "openai/gpt-5.4",
            models: new Map([["openai/gpt-5.4", { maxOutputTokens: 200, providerToolNames: [] }]]),
          },
        }),
      ExecutorRuntimePreparationError,
    );
  });

  it("does not allow streaming before runtime preparation", async () => {
    const f = fixture();
    try {
      const stream = f.owner.operations.get("agent.stream");
      assert(stream?.mode === "stream");
      await assertRejects(
        () =>
          Array.fromAsync(
            stream.handle({}, {
              binding,
              signal: new AbortController().signal,
              deadline: Date.now() + 10_000,
            }),
          ),
        ExecutorRuntimePreparationError,
      );
      const result = await prepare(f.owner);
      assert(
        result !== null && typeof result === "object" && !Array.isArray(result) &&
          result.ok === true,
      );
    } finally {
      await f.owner.close();
    }
  });

  it("preserves sanitized private facade setup errors and cleans partial preparation", async () => {
    const f = fixture({
      grant: { ...grant, remoteToolSourceIds: ["api"] },
      facades: {
        remoteToolSources: new Map([["api", {
          id: "api",
          listTools: () =>
            Promise.reject(PERMISSION_DENIED.create({ detail: "synthetic-private-diagnostic" })),
          executeTool: () => Promise.reject(new Error("Unused")),
        }]]),
      },
    });
    try {
      assertEquals(await prepare(f.owner), { ok: false, code: "PERMISSION_DENIED" });
      assertEquals(f.cleanups, 1);
    } finally {
      await f.owner.close();
    }
  });

  for (const outcome of ["throws", "returns no model"] as const) {
    it(`cleans reserved facade resources when model resolution ${outcome}`, async () => {
      let retained = false;
      let cleanups = 0;
      const f = fixture({
        facades: {
          resolveModelRuntime: () => {
            retained = true;
            if (outcome === "throws") {
              throw PERMISSION_DENIED.create({ detail: "synthetic-private-diagnostic" });
            }
            return undefined;
          },
          cleanup: () => {
            assert(retained);
            retained = false;
            cleanups++;
            return Promise.resolve();
          },
        },
      });
      try {
        assertEquals(await prepare(f.owner), {
          ok: false,
          code: outcome === "throws"
            ? "PERMISSION_DENIED"
            : "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
        });
        assertEquals(retained, false);
        assertEquals(cleanups, 1);
      } finally {
        await f.owner.close();
      }
      assertEquals(cleanups, 1);
    });
  }

  it("rejects source, mode, and authority fields from wire preparation", async () => {
    const values: JsonValue[] = [{ agentId: "coder", source }, {
      agentId: "coder",
      execution: { kind: "ephemeral" },
    }, { agentId: "coder", authToken: "synthetic" }];
    for (const value of values) {
      const f = fixture();
      try {
        assertEquals(await prepare(f.owner, value), {
          ok: false,
          code: "EXECUTOR_RUNTIME_INVALID_INPUT",
        });
      } finally {
        await f.owner.close();
      }
    }
  });

  it("rejects agent mismatch and model/output escalation before runtime assembly", async () => {
    const values: JsonValue[] = [{ agentId: "other" }, {
      agentId: "coder",
      modelId: "veryfront-cloud/openai/ungranted",
    }, { agentId: "coder", maxOutputTokens: 201 }];
    for (const value of values) {
      const f = fixture();
      try {
        assertEquals(await prepare(f.owner, value), {
          ok: false,
          code: "EXECUTOR_RUNTIME_NOT_GRANTED",
        });
      } finally {
        await f.owner.close();
      }
    }
  });

  it("requires all declared private facades before preparing any sources", async () => {
    let listed = 0;
    const f = fixture({
      grant: { ...grant, hostToolFacadeIds: ["sandbox"], remoteToolSourceIds: ["api"] },
      facades: {
        remoteToolSources: new Map([["api", {
          id: "api",
          listTools: () => {
            listed++;
            return Promise.resolve([]);
          },
          executeTool: () => Promise.reject(new Error("Unused")),
        }]]),
      },
    });
    try {
      assertEquals(await prepare(f.owner), {
        ok: false,
        code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
      });
      assertEquals(listed, 0);
    } finally {
      await f.owner.close();
    }
  });

  it("never downgrades canonical preparation when checkpoint or parent persistence is unavailable", async () => {
    const f = fixture({
      grant: {
        ...grant,
        execution: {
          kind: "canonical",
          projectId: "project-1",
          conversationId: "conversation-1",
          runId: "run-1",
          messageId: "message-1",
          providerReplay: "required",
        },
      },
    });
    try {
      assertEquals(await prepare(f.owner), {
        ok: false,
        code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
      });
    } finally {
      await f.owner.close();
    }
  });

  it("prepares once, streams through the existing raw adapter, and cleans local resources once", async () => {
    const f = fixture();
    const forward = new TransformStream<Uint8Array, Uint8Array>();
    const backward = new TransformStream<Uint8Array, Uint8Array>();
    const broker = createExecutorChannel({
      binding,
      transport: { readable: backward.readable, writable: forward.writable },
    });
    const executor = createExecutorChannel({
      binding,
      operations: f.owner.operations,
      transport: { readable: forward.readable, writable: backward.writable },
    });
    try {
      const result = await broker.request("runtime.prepare", {
        agentId: "coder",
        maxOutputTokens: 100,
      });
      assert(
        result !== null && typeof result === "object" && !Array.isArray(result) &&
          result.ok === true,
      );
      const prepared = result.value;
      assert(prepared !== null && typeof prepared === "object" && !Array.isArray(prepared));
      assert(typeof prepared.preparedRuntimeHandle === "string");
      assertEquals(prepared.modelId, modelId);
      assertEquals(await broker.request("runtime.prepare", { agentId: "coder" }), {
        ok: false,
        code: "EXECUTOR_RUNTIME_ALREADY_PREPARED",
      });
      const remote = createExecutorHostedChatRuntimeAgent({
        channel: broker,
        preparedRuntimeHandle: prepared.preparedRuntimeHandle,
      });
      const response = await remote.stream({
        messages: [{
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Synthetic question" }],
          timestamp: 1,
        }],
        abortSignal: new AbortController().signal,
      });
      const chunks = await Array.fromAsync(
        response.toUIMessageStream({ generateMessageId: () => "broker-message" }),
      );
      assert(
        chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Synthetic answer"),
      );
      assertEquals(chunks.at(-1)?.type, "finish");
      assertEquals(f.cleanups, 1);
      assertEquals(broker.signal.aborted, false);
    } finally {
      broker.close();
      await executor.closed;
      await f.owner.close();
    }
    assertEquals(f.cleanups, 1);
    assertEquals(f.discoveryCleanups, 1);
  });

  for (const cancellation of ["operation", "owner", "discovery"] as const) {
    it(`cancels remote facade listing after ${cancellation} cancellation`, async () => {
      const entered = Promise.withResolvers<void>();
      const listing = Promise.withResolvers<[]>();
      const operationAbort = new AbortController();
      let listingSignal: AbortSignal | undefined;
      const f = fixture({
        grant: { ...grant, remoteToolSourceIds: ["api"] },
        facades: {
          remoteToolSources: new Map([["api", {
            id: "api",
            listTools: (context) => {
              listingSignal = context?.abortSignal;
              listingSignal?.addEventListener("abort", () => {
                listing.reject(new Error("Synthetic listing cancellation"));
              }, { once: true });
              entered.resolve();
              return listing.promise;
            },
            executeTool: () => Promise.reject(new Error("Unused")),
          }]]),
        },
      });
      const operation = f.owner.operations.get("runtime.prepare");
      assert(operation?.mode === "unary");
      const pending = operation.handle({ agentId: "coder" }, {
        binding,
        signal: operationAbort.signal,
        deadline: Date.now() + 30_000,
      });
      try {
        await entered.promise;
        assert(listingSignal, "Remote listing must receive the preparation signal");
        assertEquals(listingSignal.aborted, false);
        if (cancellation === "operation") operationAbort.abort();
        else if (cancellation === "discovery") f.controller.abort();
        else void f.owner.close();
        assertEquals(listingSignal.aborted, true);
        assertEquals(await pending, { ok: false, code: "ABORTED" });
        await f.owner.settled;
        assertEquals(f.cleanups, 1);
        assertEquals(f.discoveryCleanups, 1);
      } finally {
        listing.resolve([]);
        await pending;
        await f.owner.close();
      }
    });
  }

  it("joins late preparation and cleanup after cancellation", async () => {
    const listing = Promise.withResolvers<[]>();
    const entered = Promise.withResolvers<void>();
    const f = fixture({
      grant: { ...grant, remoteToolSourceIds: ["api"] },
      facades: {
        remoteToolSources: new Map([["api", {
          id: "api",
          listTools: () => {
            entered.resolve();
            return listing.promise;
          },
          executeTool: () => Promise.reject(new Error("Unused")),
        }]]),
      },
    });
    const pending = prepare(f.owner);
    await entered.promise;
    const closing = f.owner.close();
    assertEquals(f.cleanups, 0);
    listing.resolve([]);
    assertEquals(await pending, { ok: false, code: "ABORTED" });
    await closing;
    assertEquals(f.cleanups, 1);
    assertEquals(f.discoveryCleanups, 1);
    assertEquals(await prepare(f.owner), { ok: false, code: "EXECUTOR_RUNTIME_CLOSED" });
  });
});

async function preparedStream(
  f: ReturnType<typeof fixture>,
  request: JsonValue = { agentId: "coder" },
  userText = "Synthetic question",
  signal = new AbortController().signal,
) {
  const result = await prepare(f.owner, request);
  assert(result && typeof result === "object" && !Array.isArray(result) && result.ok === true);
  const operation = f.owner.operations.get("agent.stream");
  assert(operation?.mode === "stream");
  const prepared = result.value;
  assert(prepared && typeof prepared === "object" && !Array.isArray(prepared));
  return operation.handle({
    preparedRuntimeHandle: prepared.preparedRuntimeHandle!,
    messages: [{
      id: "synthetic-message",
      role: "user",
      parts: [{ type: "text", text: userText }],
      timestamp: 1,
    }],
  }, {
    binding,
    signal,
    deadline: Date.now() + 30_000,
  });
}

function finishStream(toolName?: string, input: Record<string, unknown> = {}) {
  return Promise.resolve({
    stream: new ReadableStream<unknown>({
      start(controller) {
        if (toolName) {
          controller.enqueue({ type: "tool-call", toolCallId: "synthetic-call", toolName, input });
        }
        controller.enqueue({
          type: "finish",
          finishReason: toolName ? "tool-calls" : "stop",
          usage: { inputTokens: 1, outputTokens: 1 },
        });
        controller.close();
      },
    }),
  });
}

function syntheticHostTool() {
  return {
    description: "Synthetic tool",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => ({ ok: true }),
  };
}

function syntheticRemoteTool(name: string): ToolDefinition {
  return { name, description: "Synthetic tool", parameters: { type: "object", properties: {} } };
}

describe("executor runtime preparation review regressions", () => {
  it("retains the steering preparation method and its original receiver through discovery", async () => {
    class Steering {
      #calls: string[] = [];
      prepare(
        { definition }: Parameters<
          NonNullable<ExecutorRuntimeFacades["projectSteering"]>["prepare"]
        >[0],
      ) {
        this.#calls.push("prepare");
        return Promise.resolve({ agent: definition });
      }
      refresh() {
        return "Synthetic instructions";
      }
      get calls() {
        return this.#calls;
      }
    }
    const steering = new Steering();
    const f = fixture({
      facades: { projectSteering: steering },
      load: () => {
        steering.prepare = () => {
          throw new Error("Replaced preparation method");
        };
        return Promise.resolve(runtime());
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assert(steering.calls.includes("prepare"));
    } finally {
      await f.owner.close();
    }
  });

  for (const missing of ["prepare", "refresh"] as const) {
    it(`refuses inherited steering ${missing} without exposing its facade`, async () => {
      let reads = 0;
      const steering: Partial<NonNullable<ExecutorRuntimeFacades["projectSteering"]>> = {
        prepare: ({ definition }) => Promise.resolve({ agent: definition }),
        refresh: () => "Synthetic instructions",
      };
      delete steering[missing];
      const f = fixture({
        grant: { ...grant, requiredCapabilities: ["project-steering"] },
        facades: {
          projectSteering: steering as NonNullable<ExecutorRuntimeFacades["projectSteering"]>,
        },
        load: () => {
          Object.setPrototypeOf(steering, {
            get [missing]() {
              reads++;
              return () => Promise.resolve(undefined);
            },
          });
          return Promise.resolve(runtime());
        },
      });
      try {
        assertEquals(await prepare(f.owner), {
          ok: false,
          code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
        });
        assertEquals(reads, 0);
      } finally {
        await f.owner.close();
      }
    });
  }

  for (const method of ["own", "prototype"] as const) {
    it(`preserves the original receiver for ${method} cleanup methods`, async () => {
      class Facades implements ExecutorRuntimeFacades {
        #cleanups = 0;
        resolveModelRuntime = () => model;
        hostTools = new Map<string, HostToolSet>();
        remoteToolSources = new Map<string, RemoteToolSource>();
        cleanup() {
          this.#cleanups++;
          return Promise.resolve();
        }
        get cleanups() {
          return this.#cleanups;
        }
      }
      const facades = new Facades();
      if (method === "own") {
        Object.defineProperty(facades, "cleanup", { value: facades.cleanup, enumerable: true });
      }
      const f = fixture({ facadeInstance: facades });
      try {
        assertEquals((await prepare(f.owner) as { ok: boolean }).ok, true);
      } finally {
        await f.owner.close();
      }
      assertEquals(facades.cleanups, 1);
    });
  }

  it("validates preparation requests without inheriting optional model limits", () => {
    let reads = 0;
    const request = Object.create({
      get modelId() {
        reads++;
        return "veryfront-cloud/openai/other";
      },
      get maxOutputTokens() {
        reads++;
        return 999;
      },
    }, { agentId: { value: "coder", enumerable: true } });
    const parsed = parseRuntimePreparationData(getExecutorRuntimePrepareRequestSchema(), request);
    assertEquals(reads, 0);
    assertEquals(parsed.modelId, undefined);
    assertEquals(parsed.maxOutputTokens, undefined);
  });

  it("does not treat inherited steering skills as authorized", async () => {
    let reads = 0;
    let visible: string[] = [];
    const f = fixture({
      config: { tools: {}, skills: true },
      grant: { ...grant, allowedToolNames: ["load_skill"], hostToolFacadeIds: ["skills"] },
      facades: {
        hostTools: new Map([["skills", { load_skill: syntheticHostTool() }]]),
        projectSteering: {
          prepare: ({ definition }) =>
            Promise.resolve(Object.create({
              get initialSkills() {
                reads++;
                return [{
                  id: "injected",
                  name: "Injected",
                  description: "Synthetic",
                  instructions: "Synthetic",
                }];
              },
            }, { agent: { value: definition, enumerable: true } })),
          refresh: () => "Synthetic instructions",
        },
        resolveModelRuntime: () => ({
          ...model,
          doStream(options) {
            visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
            return finishStream();
          },
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(reads, 0);
      assertEquals(visible, []);
    } finally {
      await f.owner.close();
    }
  });

  it("ignores inherited initial checkpoint state during canonical preparation", async () => {
    let inheritedReads = 0;
    type CheckpointFacade = NonNullable<ExecutorRuntimeFacades["toolExposureCheckpoint"]>;
    const checkpoint: CheckpointFacade = Object.create({
      get initial() {
        inheritedReads++;
        return { version: 1, loadedToolNames: [] };
      },
    }, {
      persist: {
        value: () => Promise.resolve(),
        enumerable: true,
      },
    });
    let calls = 0;
    const f = fixture({
      grant: {
        ...grant,
        allowedToolNames: ["visible"],
        hostToolFacadeIds: ["local"],
        execution: {
          kind: "canonical",
          projectId: null,
          conversationId: "synthetic-conversation",
          runId: "synthetic-run",
          messageId: "synthetic-message",
          providerReplay: "disabled",
        },
      },
      facades: {
        hostTools: new Map([["local", { visible: syntheticHostTool() }]]),
        toolExposureCheckpoint: checkpoint,
        publishParentRunEvents: () => Promise.resolve(),
        resolveModelRuntime: () => ({
          ...model,
          doStream: () => finishStream(calls++ === 0 ? "visible" : undefined),
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(inheritedReads, 0);
      assertEquals(calls, 2);
    } finally {
      await f.owner.close();
    }
  });

  it("preserves a granted provider-selected local web fetch fallback", async () => {
    let visible: string[] = [];
    const f = fixture({
      config: { tools: {}, providerTools: ["web_fetch"] },
      grant: {
        ...grant,
        allowedToolNames: ["web_fetch"],
        hostToolFacadeIds: ["local"],
        models: new Map([[
          modelId,
          { maxOutputTokens: 200, providerToolNames: ["web_fetch"] },
        ]]),
      },
      facades: {
        hostTools: new Map([["local", { web_fetch: syntheticHostTool() }]]),
        resolveModelRuntime: () => ({
          ...model,
          doStream(options) {
            visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
            return finishStream();
          },
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(visible, ["web_fetch"]);
    } finally {
      await f.owner.close();
    }
  });

  for (
    const selection of [
      {
        name: "omitted tools",
        tools: "",
        expected: ["invoke_agent", "load_skill"],
      },
      {
        name: "configured tools",
        tools: "tools: [read_file]",
        expected: ["invoke_agent", "load_skill", "read_file"],
      },
      { name: "empty caller selector", tools: "", requested: [], expected: [] },
      {
        name: "caller narrows configured tools",
        tools: "tools: [read_file]",
        requested: ["read_file"],
        expected: ["read_file"],
      },
      { name: "missing grants", tools: "", granted: [], expected: [] },
      {
        name: "denied infrastructure",
        tools: "denied-tools: [load_skill, load_skill_reference, invoke_agent]",
        expected: [],
      },
      {
        name: "unrestricted denial",
        tools: "tools: true\ndenied-tools: [read_file]",
        expected: [],
      },
      { name: "no matching skills", tools: "", skills: [], expected: [] },
    ]
  ) {
    it(`retains granted skill infrastructure for Markdown agents: ${selection.name}`, async () => {
      const state = runtime();
      state.agents.set(
        "coder",
        createRuntimeAgentFromMarkdownDefinition(parseRuntimeAgentMarkdownDefinition({
          id: "coder",
          content: `---\nskills: true\n${selection.tools}\n---\nSynthetic instructions.`,
        })),
      );
      const names = [
        "load_skill",
        "load_skill_reference",
        "invoke_agent",
        "execute_skill_script",
        "read_file",
      ];
      let visible: string[] = [];
      const executions: string[] = [];
      let calls = 0;
      const f = fixture({
        load: () => Promise.resolve(state),
        grant: {
          ...grant,
          allowedToolNames: selection.granted ?? names,
          hostToolFacadeIds: ["skills"],
        },
        facades: {
          hostTools: new Map([[
            "skills",
            Object.fromEntries(names.map((name) => [name, {
              ...syntheticHostTool(),
              execute: () => {
                executions.push(name);
                return { ok: true };
              },
            }])),
          ]]),
          projectSteering: {
            prepare: ({ definition }) =>
              Promise.resolve({
                agent: definition,
                initialSkills: selection.skills ??
                  [{
                    id: "example",
                    name: "Example",
                    description: "Synthetic",
                    instructions: "Synthetic instructions",
                    allowedTools: [],
                  }],
              }),
            refresh: () => "Synthetic instructions",
          },
          resolveModelRuntime: () => ({
            ...model,
            doStream(options) {
              visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
              return finishStream(
                calls++ === 0 && visible.includes("invoke_agent") ? "invoke_agent" : undefined,
              );
            },
          }),
        },
      });
      try {
        await Array.fromAsync(
          await preparedStream(f, {
            agentId: "coder",
            ...(selection.requested === undefined ? {} : { allowedToolNames: selection.requested }),
          }),
        );
        assertEquals([...visible].sort(), [...selection.expected].sort());
        assertEquals(
          executions,
          selection.expected.some((name) => name === "invoke_agent") ? ["invoke_agent"] : [],
        );
      } finally {
        await f.owner.close();
      }
    });
  }
  for (const cancellation of ["operation", "owner"] as const) {
    it(`cancels steering refresh on ${cancellation} abort and joins it before cleanup`, async () => {
      const entered = Promise.withResolvers<void>();
      const unblock = Promise.withResolvers<void>();
      const abort = new AbortController();
      let refreshSignal: AbortSignal | undefined;
      let calls = 0;
      const f = fixture({
        grant: {
          ...grant,
          allowedToolNames: ["update_file"],
          remoteToolSourceIds: ["api"],
          execution: { kind: "ephemeral", projectId: "synthetic-project" },
        },
        facades: {
          projectSteering: {
            prepare: ({ definition }) => Promise.resolve({ agent: definition }),
            refresh: async (signal?: AbortSignal) => {
              refreshSignal = signal;
              entered.resolve();
              await unblock.promise;
              signal?.throwIfAborted();
              return "Updated instructions";
            },
          },
          remoteToolSources: new Map([["api", {
            id: "api",
            listTools: () =>
              Promise.resolve([{
                ...syntheticRemoteTool("update_file"),
                parameters: {
                  type: "object",
                  properties: { path: { type: "string" }, project_reference: { type: "string" } },
                  required: ["project_reference"],
                },
              }]),
            executeTool: () => Promise.resolve({ success: true }),
          }]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream: () =>
              finishStream(calls++ === 0 ? "update_file" : undefined, { path: "AGENTS.md" }),
          }),
        },
      });
      const consuming = Array.fromAsync(
        await preparedStream(f, { agentId: "coder" }, "Synthetic question", abort.signal),
      ).catch(() => []);
      try {
        await Promise.race([
          entered.promise,
          consuming.then((frames) => {
            throw new Error(`Stream completed before refresh: ${JSON.stringify(frames)}`);
          }),
        ]);
        assert(refreshSignal, "refresh must receive its runtime cancellation signal");
        assertEquals(refreshSignal.aborted, false);
        if (cancellation === "operation") abort.abort();
        else void f.owner.close();
        assertEquals(refreshSignal.aborted, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(f.cleanups, 0);
        assertEquals(f.discoveryCleanups, 0);
      } finally {
        unblock.resolve();
        await consuming;
        await f.owner.close();
      }
      assertEquals(f.cleanups, 1);
      assertEquals(f.discoveryCleanups, 1);
    });
  }

  it("sanitizes project tool failures before streaming them from the prepared runtime", async () => {
    const privateDetail = "synthetic-private-project-detail";
    let modelCalls = 0;
    const projectRuntime = runtime({ tools: { project_failure: true } });
    projectRuntime.tools.set("project_failure", {
      id: "project_failure",
      type: "function",
      description: "Synthetic project tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        throw new Error(privateDetail);
      },
    });
    const f = fixture({
      grant: { ...grant, allowedToolNames: ["project_failure"] },
      load: () => Promise.resolve(projectRuntime),
      facades: {
        resolveModelRuntime: () => ({
          ...model,
          doStream: () => finishStream(modelCalls++ === 0 ? "project_failure" : undefined),
        }),
      },
    });
    try {
      const frames = await Array.fromAsync(await preparedStream(f));
      const serialized = JSON.stringify(frames);
      assertEquals(serialized.includes(privateDetail), false);
      assertEquals(serialized.includes("Hosted project tool execution failed"), true);
    } finally {
      await f.owner.close();
    }
  });

  it("cancels latest conversation text loading before facade cleanup", async () => {
    const entered = Promise.withResolvers<void>();
    let observedSignal: AbortSignal | undefined;
    const f = fixture({
      facades: {
        latestConversationUserText: (signal) => {
          observedSignal = signal;
          entered.resolve();
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
    });
    const pending = prepare(f.owner);
    await entered.promise;
    const closing = f.owner.close();
    assertEquals(observedSignal?.aborted, true);
    assertEquals(await pending, { ok: false, code: "ABORTED" });
    await closing;
    assertEquals(f.cleanups, 1);
  });

  it("refuses selected project navigation before starting fixed-project facades", async () => {
    let facadeCalls = 0;
    const f = fixture({
      grant: {
        ...grant,
        allowedToolNames: ["studio_open_project"],
        remoteToolSourceIds: ["studio"],
        execution: { kind: "ephemeral", projectId: "project-one" },
      },
      facades: {
        projectSteering: {
          prepare: ({ definition }) => Promise.resolve({ agent: definition }),
          refresh: () => "Synthetic source instructions.",
        },
        resolveModelRuntime: () => {
          facadeCalls++;
          return model;
        },
        remoteToolSources: new Map([["studio", {
          id: "studio",
          listTools: () => {
            facadeCalls++;
            return Promise.resolve([syntheticRemoteTool("studio_open_project")]);
          },
          executeTool: () => {
            facadeCalls++;
            return Promise.resolve({ ok: true });
          },
        }]]),
      },
    });
    try {
      assertEquals(await prepare(f.owner), {
        ok: false,
        code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
      });
      assertEquals(facadeCalls, 0);
    } finally {
      await f.owner.close();
    }
  });

  it("keeps unselected navigation outside a run bound to its granted project", async () => {
    const executions: { name: string; args: Record<string, unknown> }[] = [];
    let calls = 0;
    const f = fixture({
      grant: {
        ...grant,
        allowedToolNames: ["studio_open_project", "update_file"],
        remoteToolSourceIds: ["studio"],
        execution: { kind: "ephemeral", projectId: "project-one" },
      },
      facades: {
        projectSteering: {
          prepare: ({ definition }) => Promise.resolve({ agent: definition }),
          refresh: () => "Synthetic source instructions.",
        },
        remoteToolSources: new Map([["studio", {
          id: "studio",
          listTools: () =>
            Promise.resolve(["studio_open_project", "update_file"].map((name) => ({
              ...syntheticRemoteTool(name),
              parameters: {
                type: "object",
                properties: { project_reference: { type: "string" } },
                required: ["project_reference"],
              },
            }))),
          executeTool: (name, args) => {
            executions.push({ name, args });
            return Promise.resolve({ ok: true });
          },
        }]]),
        resolveModelRuntime: () => ({
          ...model,
          doStream(options) {
            assertEquals((options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name), [
              "update_file",
            ]);
            return finishStream(calls++ === 0 ? "update_file" : undefined, {
              project_reference: "project-two",
            });
          },
        }),
      },
    });
    try {
      await Array.fromAsync(
        await preparedStream(f, {
          agentId: "coder",
          allowedToolNames: ["update_file"],
        }),
      );
      assertEquals(executions, [{
        name: "update_file",
        args: { project_reference: "project-one" },
      }]);
    } finally {
      await f.owner.close();
    }
  });

  for (
    const selection of [
      { name: "declared delegate", expected: ["read_file", "agent_writer"] },
      { name: "narrowed request", requested: ["read_file"], expected: ["read_file"] },
      { name: "empty request", requested: [], expected: [] },
      { name: "denied delegate", denied: ["agent_writer"], expected: ["read_file"] },
      { name: "missing grant", granted: [], expected: [] },
      { name: "omitted tools", frontmatter: "", expected: [] },
      {
        name: "omitted tools with delegates",
        frontmatter: "delegates: [writer, ungranted]",
        expected: ["agent_writer"],
      },
      {
        name: "unrestricted tools with a denial",
        frontmatter: "tools: true",
        denied: ["read_file"],
        expected: [],
      },
      {
        name: "unrestricted tools without denials",
        frontmatter: "tools: true",
        expected: ["read_file", "agent_writer", "agent_undeclared"],
      },
    ]
  ) {
    it(`applies Markdown tool bindings within authority: ${selection.name}`, async () => {
      const definition = parseRuntimeAgentMarkdownDefinition({
        id: "coder",
        content: `---
${selection.frontmatter ?? "tools: [read_file]\ndelegates: [writer, ungranted]"}
denied-tools: ${JSON.stringify(selection.denied ?? [])}
---
Synthetic source instructions.`,
      });
      const state = runtime();
      state.agents.set("coder", createRuntimeAgentFromMarkdownDefinition(definition));
      const executions: string[] = [];
      let visible: string[] = [];
      let calls = 0;
      const f = fixture({
        load: () => Promise.resolve(state),
        grant: {
          ...grant,
          allowedToolNames: selection.granted ?? ["read_file", "agent_writer", "agent_undeclared"],
          hostToolFacadeIds: ["delegates"],
        },
        facades: {
          hostTools: new Map([[
            "delegates",
            Object.fromEntries(
              ["read_file", "agent_writer", "agent_ungranted", "agent_undeclared"].map((name) => [
                name,
                {
                  ...syntheticHostTool(),
                  execute: () => {
                    executions.push(name);
                    return { ok: true };
                  },
                },
              ]),
            ),
          ]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream(options) {
              visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
              return finishStream(
                calls++ === 0 ? visible.find((name) => name === "agent_writer") : undefined,
              );
            },
          }),
        },
      });
      try {
        await Array.fromAsync(
          await preparedStream(f, {
            agentId: "coder",
            ...(selection.requested === undefined ? {} : { allowedToolNames: selection.requested }),
          }),
        );
        assertEquals([...visible].sort(), [...selection.expected].sort());
        assertEquals(
          executions,
          selection.expected.some((name) => name === "agent_writer") ? ["agent_writer"] : [],
        );
      } finally {
        await f.owner.close();
      }
    });
  }

  for (
    const selection of [
      { name: "omitted binding", expected: [] },
      { name: "explicit binding", configured: ["web_search"], expected: ["web_search"] },
      { name: "empty binding", configured: [], expected: [] },
      { name: "request cannot add a binding", requested: ["web_search"], expected: [] },
      { name: "binding requires a grant", configured: ["web_search"], granted: [], expected: [] },
      {
        name: "request removes a binding",
        configured: ["web_search"],
        requested: [],
        expected: [],
      },
    ]
  ) {
    it(`selects provider tools within authored bindings: ${selection.name}`, async () => {
      let visible: string[] = [];
      const f = fixture({
        config: { providerTools: selection.configured },
        grant: {
          ...grant,
          models: new Map([[modelId, {
            maxOutputTokens: 200,
            providerToolNames: selection.granted ?? ["web_search"],
          }]]),
        },
        facades: {
          resolveModelRuntime: () => ({
            ...model,
            doStream(options) {
              visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
              return finishStream();
            },
          }),
        },
      });
      try {
        await Array.fromAsync(
          await preparedStream(f, {
            agentId: "coder",
            ...(selection.requested === undefined
              ? {}
              : { providerToolNames: selection.requested }),
          }),
        );
        assertEquals(visible, selection.expected);
      } finally {
        await f.owner.close();
      }
    });
  }

  it("retains discovery resources during preparation after upstream abort", async () => {
    const entered = Promise.withResolvers<void>();
    const listing = Promise.withResolvers<[]>();
    const f = fixture({
      grant: { ...grant, remoteToolSourceIds: ["api"] },
      facades: {
        remoteToolSources: new Map([["api", {
          id: "api",
          listTools: () => {
            entered.resolve();
            return listing.promise;
          },
          executeTool: () => Promise.reject(new Error("Unused")),
        }]]),
      },
    });
    const pending = prepare(f.owner);
    await entered.promise;
    f.controller.abort();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(f.cleanups, 0);
      assertEquals(f.discoveryCleanups, 0);
    } finally {
      listing.resolve([]);
      assertEquals(await pending, { ok: false, code: "ABORTED" });
      await Promise.all([f.owner.settled, f.discovery.settled]);
    }
    assertEquals(f.cleanups, 1);
    assertEquals(f.discoveryCleanups, 1);
  });

  for (const outcome of ["abort", "failure"] as const) {
    it(`settles preparation and discovery without a cleanup cycle on discovery ${outcome}`, async () => {
      const entered = Promise.withResolvers<void>();
      const loaded = Promise.withResolvers<ProjectAgentRuntimeDiscovery>();
      const f = fixture({
        load: () => {
          entered.resolve();
          return loaded.promise;
        },
      });
      const pending = prepare(f.owner);
      await entered.promise;
      if (outcome === "abort") {
        f.controller.abort();
        loaded.resolve(runtime());
      } else {
        loaded.reject(new Error("Synthetic discovery failure"));
      }
      assertEquals(await pending, { ok: false, code: "ABORTED" });
      await Promise.all([f.owner.settled, f.discovery.settled]);
      assertEquals(f.cleanups, 0);
      assertEquals(f.discoveryCleanups, 1);
    });
  }

  for (const cancellation of ["owner close", "upstream discovery abort"] as const) {
    for (const phase of ["startup", "model", "tool"] as const) {
      it(`joins original ${phase} work after ${cancellation} before cleanup and settlement`, async () => {
        const entered = Promise.withResolvers<void>();
        const unblock = Promise.withResolvers<void>();
        const finished = Promise.withResolvers<void>();
        const wait = async () => {
          entered.resolve();
          try {
            await unblock.promise;
          } finally {
            finished.resolve();
          }
        };
        let calls = 0;
        const f = fixture({
          grant: { ...grant, allowedToolNames: ["work"], remoteToolSourceIds: ["api"] },
          facades: {
            resolveModelRuntime: () => ({
              ...model,
              ...(phase === "startup" ? { prepare: wait } : {}),
              doStream: async () => {
                if (phase === "model") await wait();
                return finishStream(phase === "tool" && calls++ === 0 ? "work" : undefined);
              },
            }),
            remoteToolSources: new Map([["api", {
              id: "api",
              listTools: () => Promise.resolve([syntheticRemoteTool("work")]),
              executeTool: async () => {
                await wait();
                return { ok: true };
              },
            }]]),
          },
        });
        const stream = await preparedStream(f);
        const consuming = Array.fromAsync(stream).catch(() => []);
        await entered.promise;
        let settled = false;
        void f.owner.settled.then(() => {
          settled = true;
        });
        let discoverySettled = false;
        void f.discovery.settled.then(() => {
          discoverySettled = true;
        });
        if (cancellation === "upstream discovery abort") f.controller.abort();
        const closing = cancellation === "owner close" ? f.owner.close() : f.owner.settled;
        try {
          await new Promise((resolve) => setTimeout(resolve, 0));
          assertEquals(f.cleanups, 0);
          assertEquals(f.discoveryCleanups, 0);
          assertEquals(settled, false);
          assertEquals(discoverySettled, false);
        } finally {
          unblock.resolve();
          await finished.promise;
          await closing;
          await f.discovery.settled;
          await consuming;
        }
        assertEquals(f.cleanups, 1);
        assertEquals(f.discoveryCleanups, 1);
      });
    }
  }

  for (const outcome of ["complete", "failure", "abort"] as const) {
    it(`forwards installed resolver revocation on ${outcome}`, async () => {
      let revocations = 0;
      const entered = Promise.withResolvers<void>();
      const unblock = Promise.withResolvers<void>();
      const resolver = () => ({
        ...model,
        doStream: async () => {
          entered.resolve();
          if (outcome === "abort") await unblock.promise;
          if (outcome === "failure") throw new Error("Synthetic model failure");
          return finishStream();
        },
      });
      registerModelRuntimeResolverRevoker(resolver, () => {
        revocations++;
      });
      const f = fixture({ facades: { resolveModelRuntime: resolver } });
      try {
        const consuming = Array.fromAsync(await preparedStream(f)).catch(() => []);
        await entered.promise;
        if (outcome === "abort") {
          const closing = f.owner.close();
          unblock.resolve();
          await closing;
        }
        await consuming;
        assertEquals(revocations, 1);
      } finally {
        unblock.resolve();
        await f.owner.close();
      }
      assertEquals(revocations, 1);
    });
  }

  for (const toolPolicy of [{ allow: ["read_file"] }, { deny: ["update_file"] }]) {
    it(`applies the declared MCP ${toolPolicy.allow ? "allow" : "deny"} policy to its facade`, async () => {
      const f = fixture({
        config: { mcpServers: [{ kind: "veryfront-api", id: "api", toolPolicy }] },
        grant: { ...grant, allowedToolNames: ["update_file"], remoteToolSourceIds: ["api"] },
        facades: {
          remoteToolSources: new Map([["api", {
            id: "api",
            listTools: () => Promise.resolve([syntheticRemoteTool("update_file")]),
            executeTool: () => Promise.reject(new Error("Disallowed tool executed")),
          }]]),
        },
      });
      try {
        assertEquals(await prepare(f.owner), {
          ok: false,
          code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
        });
      } finally {
        await f.owner.close();
      }
    });
  }

  it("accepts 129 granted tools before applying the provider cap", async () => {
    const names = Array.from({ length: 129 }, (_, i) => `tool_${String(i).padStart(3, "0")}`);
    let visible: string[] = [];
    const f = fixture({
      grant: { ...grant, allowedToolNames: names, remoteToolSourceIds: ["api"] },
      facades: {
        remoteToolSources: new Map([["api", {
          id: "api",
          listTools: () => Promise.resolve(names.map(syntheticRemoteTool)),
          executeTool: () => Promise.resolve({ ok: true }),
        }]]),
        resolveModelRuntime: () => ({
          ...model,
          doStream: (options) => {
            visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
            return finishStream();
          },
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(visible.length, 128);
    } finally {
      await f.owner.close();
    }
  });

  it("keeps an MCP denial scoped to its source when another facade grants the same name", async () => {
    const executions: string[] = [];
    let calls = 0;
    const f = fixture({
      config: {
        mcpServers: [{
          kind: "veryfront-api",
          id: "restricted",
          toolPolicy: { deny: ["update_file"] },
        }],
      },
      grant: {
        ...grant,
        allowedToolNames: ["update_file"],
        remoteToolSourceIds: ["restricted", "allowed"],
      },
      facades: {
        remoteToolSources: new Map(["restricted", "allowed"].map((id) => [id, {
          id,
          listTools: () => Promise.resolve([syntheticRemoteTool("update_file")]),
          executeTool: () => {
            executions.push(id);
            return Promise.resolve({ ok: true });
          },
        }])),
        resolveModelRuntime: () => ({
          ...model,
          doStream: () => finishStream(calls++ === 0 ? "update_file" : undefined),
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(executions, ["allowed"]);
    } finally {
      await f.owner.close();
    }
  });

  it("refuses a selected capability that is actually missing before provider capping", async () => {
    const f = fixture({ grant: { ...grant, allowedToolNames: ["missing_tool"] } });
    try {
      assertEquals(await prepare(f.owner), {
        ok: false,
        code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
      });
    } finally {
      await f.owner.close();
    }
  });

  it("accepts an owner tool's short selector while dispatching its qualified name", async () => {
    let visible: string[] = [];
    const f = fixture({
      grant: { ...grant, allowedToolNames: ["fetch-paper"], hostToolFacadeIds: ["local"] },
      facades: {
        hostTools: new Map([["local", {
          "coder--fetch-paper": {
            ...syntheticHostTool(),
            ownerAgentId: "coder",
            shortName: "fetch-paper",
          },
        }]]),
        resolveModelRuntime: () => ({
          ...model,
          doStream: (options) => {
            visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
            return finishStream();
          },
        }),
      },
    });
    try {
      await Array.fromAsync(await preparedStream(f));
      assertEquals(visible, ["coder--fetch-paper"]);
    } finally {
      await f.owner.close();
    }
  });

  const selectorCases: {
    name: string;
    granted: string[];
    tools: AgentConfig["tools"];
    requested: string[];
    expected: string[];
  }[] = [
    {
      name: "qualified grant, short source and request",
      granted: ["coder--fetch-paper"],
      tools: { "fetch-paper": true },
      requested: ["fetch-paper"],
      expected: ["coder--fetch-paper"],
    },
    {
      name: "qualified grant and short request without a source allowlist",
      granted: ["coder--fetch-paper"],
      tools: true,
      requested: ["fetch-paper"],
      expected: ["coder--fetch-paper"],
    },
    {
      name: "short grant, qualified source and request",
      granted: ["fetch-paper"],
      tools: { "coder--fetch-paper": true },
      requested: ["coder--fetch-paper"],
      expected: ["coder--fetch-paper"],
    },
    {
      name: "short source denial against a qualified grant",
      granted: ["coder--fetch-paper"],
      tools: { "coder--fetch-paper": true, "fetch-paper": false },
      requested: ["fetch-paper"],
      expected: [],
    },
    {
      name: "qualified source denial against a short grant",
      granted: ["fetch-paper"],
      tools: { "fetch-paper": true, "coder--fetch-paper": false },
      requested: ["fetch-paper"],
      expected: [],
    },
    {
      name: "no grant despite matching source and request aliases",
      granted: [],
      tools: { "fetch-paper": true },
      requested: ["fetch-paper"],
      expected: [],
    },
    {
      name: "another owner's grant with the same short name",
      granted: ["other--fetch-paper"],
      tools: { "fetch-paper": true },
      requested: ["fetch-paper"],
      expected: [],
    },
    {
      name: "a source allowlist that excludes the granted tool",
      granted: ["coder--fetch-paper"],
      tools: { another: true },
      requested: ["fetch-paper"],
      expected: [],
    },
    {
      name: "an empty request selector",
      granted: ["coder--fetch-paper"],
      tools: { "fetch-paper": true },
      requested: [],
      expected: [],
    },
  ];
  for (const selection of selectorCases) {
    it(`normalizes selectors before intersection: ${selection.name}`, async () => {
      const state = runtime({ tools: selection.tools });
      const executions: string[] = [];
      for (const ownerAgentId of ["coder", "other"]) {
        const id = `${ownerAgentId}--fetch-paper`;
        state.tools.set(id, {
          ...syntheticHostTool(),
          id,
          type: "function",
          ownerAgentId,
          shortName: "fetch-paper",
          execute: () => {
            executions.push(id);
            return Promise.resolve({ ok: true });
          },
        });
      }
      let visible: string[] = [];
      let calls = 0;
      const f = fixture({
        load: () => Promise.resolve(state),
        grant: {
          ...grant,
          allowedToolNames: selection.granted,
          remoteToolSourceIds: ["api"],
        },
        facades: {
          remoteToolSources: new Map([["api", {
            id: "api",
            listTools: () => Promise.resolve([syntheticRemoteTool("fetch-paper")]),
            executeTool: () => Promise.reject(new Error("Ungranted alias executed")),
          }]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream: (options) => {
              visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
              return finishStream(calls++ === 0 ? visible[0] : undefined);
            },
          }),
        },
      });
      try {
        await Array.fromAsync(
          await preparedStream(f, {
            agentId: "coder",
            allowedToolNames: selection.requested,
          }),
        );
        assertEquals(visible, selection.expected);
        assertEquals(executions, selection.expected);
      } finally {
        await f.owner.close();
      }
    });
  }

  for (
    const [path, success, expectedRefreshes] of [
      ["AGENTS.md", true, 1],
      ["skills/example/SKILL.md", true, 1],
      ["AGENTS.md", false, 0],
      ["readme.txt", true, 0],
    ] as const
  ) {
    it(`refreshes steering after ${path} only on a successful steering change (${success})`, async () => {
      let calls = 0;
      let refreshes = 0;
      const systems: string[] = [];
      const f = fixture({
        grant: {
          ...grant,
          allowedToolNames: ["update_file"],
          remoteToolSourceIds: ["api"],
          execution: { kind: "ephemeral", projectId: "synthetic-project" },
        },
        facades: {
          projectSteering: {
            prepare: ({ definition }) => Promise.resolve({ agent: definition }),
            refresh: () => {
              refreshes++;
              return "Updated synthetic steering";
            },
          },
          remoteToolSources: new Map([["api", {
            id: "api",
            listTools: () =>
              Promise.resolve([{
                ...syntheticRemoteTool("update_file"),
                parameters: {
                  type: "object",
                  properties: { path: { type: "string" }, project_reference: { type: "string" } },
                  required: ["project_reference"],
                },
              }]),
            executeTool: () => Promise.resolve({ success }),
          }]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream: (options) => {
              systems.push(JSON.stringify((options as ModelRuntimeCallOptions).prompt));
              return finishStream(calls++ === 0 ? "update_file" : undefined, { path });
            },
          }),
        },
      });
      try {
        await Array.fromAsync(await preparedStream(f));
        assertEquals(calls, 2);
        assertEquals(refreshes, expectedRefreshes);
        assertEquals(systems[1]?.includes("Updated synthetic steering"), expectedRefreshes === 1);
      } finally {
        await f.owner.close();
      }
    });
  }

  for (
    const selectedModel of [
      modelId,
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
      "veryfront-cloud/anthropic/claude-opus-4-7",
    ]
  ) {
    for (const thinking of [{ enabled: false }, { enabled: true, budgetTokens: 4096 }]) {
      it(`carries explicit thinking ${thinking.enabled} into ${selectedModel} call data`, async () => {
        let captured: ModelRuntimeCallOptions | undefined;
        let sourceTransportCalls = 0;
        const adaptive = selectedModel.endsWith("claude-opus-4-7") && thinking.enabled;
        const f = fixture({
          config: {
            thinking: { enabled: !thinking.enabled },
            resolveModelTransport: () => {
              sourceTransportCalls++;
              throw new Error("Source hook called");
            },
          },
          grant: {
            ...grant,
            defaultModelId: selectedModel,
            models: new Map([[selectedModel, { maxOutputTokens: 8192, providerToolNames: [] }]]),
          },
          facades: {
            resolveModelRuntime: () => ({
              ...model,
              doStream: (options) => {
                captured = options as ModelRuntimeCallOptions;
                return finishStream();
              },
            }),
          },
        });
        try {
          await Array.fromAsync(
            await preparedStream(f, { agentId: "coder", thinking: { ...thinking } as JsonValue }),
          );
          assert(captured);
          assertEquals(sourceTransportCalls, 0);
          assertEquals(captured.headers, undefined);
          assertEquals(captured.reasoning, adaptive ? undefined : thinking);
          assertEquals(
            captured.providerOptions,
            adaptive
              ? {
                anthropic: {
                  thinking: { type: "adaptive", display: "summarized" },
                  output_config: { effort: "high" },
                },
              }
              : undefined,
          );
          assertPersistedModelOptions({
            identity: { binding, sequence: 1 },
            mode: "stream",
            model: {
              id: selectedModel,
              modelId: selectedModel,
              provider: selectedModel.includes("anthropic") ? "anthropic" : "openai",
            },
            options: captured,
          });
        } finally {
          await f.owner.close();
        }
      });
    }
  }
});

describe("executor runtime preparation artifact and materialization regressions", () => {
  const researchRequest =
    "/research Research synthetic widgets and save the report to the project.";
  const reportPath = "research/synthetic-widgets/report.md";
  const mirrorPath = "research/synthetic-widgets/runs/synthetic-run.report.md";
  const reportContent = "# Synthetic widgets\n\nSynthetic research findings.";

  for (
    const existing of ["none", "returned collision", "thrown collision", "ungranted retry"] as const
  ) {
    it(`normalizes research writes and mirrors the run report with ${existing}`, async () => {
      const files = new Map<string, string>();
      if (existing !== "none") {
        files.set(reportPath, "Previous report");
        files.set(mirrorPath, "Previous run report");
      }
      const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
      let modelCalls = 0;
      const f = fixture({
        grant: {
          ...grant,
          allowedToolNames: existing === "ungranted retry"
            ? ["create_file"]
            : ["create_file", "update_file"],
          remoteToolSourceIds: ["api"],
          execution: {
            kind: "canonical",
            projectId: "synthetic-project",
            conversationId: "synthetic-conversation",
            runId: "synthetic-run",
            messageId: "synthetic-message",
            providerReplay: "disabled",
          },
        },
        config: {
          mcpServers: [{
            kind: "veryfront-api",
            id: "api",
            toolPolicy: { allow: ["create_file", "update_file"] },
          }],
        },
        facades: {
          latestConversationUserText: () => Promise.resolve(researchRequest),
          projectSteering: {
            prepare: ({ definition }) => Promise.resolve({ agent: definition }),
            refresh: () => "Synthetic instructions",
          },
          publishParentRunEvents: () => Promise.resolve(),
          toolExposureCheckpoint: { persist: () => Promise.resolve() },
          remoteToolSources: new Map([["api", {
            id: "api",
            listTools: () =>
              Promise.resolve(["create_file", "update_file"].map((name) => ({
                ...syntheticRemoteTool(name),
                parameters: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                    project_reference: { type: "string" },
                  },
                  required: ["path", "content", "project_reference"],
                },
              }))),
            executeTool: (toolName, args) => {
              calls.push({ toolName, args });
              assertEquals(args.project_reference, "synthetic-project");
              assertEquals(typeof args.path, "string");
              if (toolName === "create_file" && files.has(String(args.path))) {
                const error = { isError: true, message: `File already exists: ${args.path}` };
                return existing === "thrown collision"
                  ? Promise.reject(error)
                  : Promise.resolve(error);
              }
              files.set(String(args.path), String(args.content));
              return Promise.resolve({ success: true, path: args.path });
            },
          }]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream: () =>
              finishStream(modelCalls++ === 0 ? "create_file" : undefined, {
                path: "report.md",
                content: reportContent,
              }),
          }),
        },
      });
      try {
        const frames = await Array.fromAsync(
          await preparedStream(f, { agentId: "coder" }, researchRequest),
        );
        assertEquals(frames.at(-1), { type: "complete" });
        const expectedCalls = existing === "none"
          ? [["create_file", reportPath], ["create_file", mirrorPath]]
          : existing === "ungranted retry"
          ? [["create_file", reportPath]]
          : [
            ["create_file", reportPath],
            ["update_file", reportPath],
            ["create_file", mirrorPath],
            ["update_file", mirrorPath],
          ];
        assertEquals(calls.map(({ toolName, args }) => [toolName, args.path]), expectedCalls);
        assertEquals([...files], [
          [reportPath, existing === "ungranted retry" ? "Previous report" : reportContent],
          [mirrorPath, existing === "ungranted retry" ? "Previous run report" : reportContent],
        ]);
      } finally {
        await f.owner.close();
      }
    });
  }

  it("refuses a selected research retry companion denied by MCP", async () => {
    let executions = 0;
    const f = fixture({
      config: {
        mcpServers: [{ kind: "veryfront-api", id: "api", toolPolicy: { deny: ["update_file"] } }],
      },
      grant: {
        ...grant,
        allowedToolNames: ["create_file", "update_file"],
        remoteToolSourceIds: ["api"],
      },
      facades: {
        latestConversationUserText: () => Promise.resolve(researchRequest),
        remoteToolSources: new Map([["api", {
          id: "api",
          listTools: () => Promise.resolve(["create_file", "update_file"].map(syntheticRemoteTool)),
          executeTool: () => {
            executions++;
            return Promise.resolve({ ok: true });
          },
        }]]),
      },
    });
    try {
      assertEquals(await prepare(f.owner), {
        ok: false,
        code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
      });
      assertEquals(executions, 0);
    } finally {
      await f.owner.close();
    }
  });

  for (
    const [name, field, value] of [
      ["missing execute", "execute", undefined],
      ["missing schema", "inputSchema", undefined],
      ["unsupported raw schema", "inputSchema", { type: "object", properties: {} }],
      ["malformed schema", "inputSchema", "unsupported-schema"],
      ["missing description", "description", undefined],
    ] as const
  ) {
    it(`refuses a selected host descriptor with ${name}`, async () => {
      let modelCalls = 0;
      const descriptor: HostToolDefinition = { ...syntheticHostTool(), [field]: value };
      const f = fixture({
        grant: { ...grant, allowedToolNames: ["work"], hostToolFacadeIds: ["local"] },
        facades: {
          hostTools: new Map([["local", { work: descriptor }]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream: () => {
              modelCalls++;
              return finishStream();
            },
          }),
        },
      });
      try {
        assertEquals(await prepare(f.owner), {
          ok: false,
          code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
        });
        assertEquals(modelCalls, 0);
        assertEquals(f.cleanups, 1);
      } finally {
        await f.owner.close();
      }
    });
  }

  for (const malformedLast of [false, true]) {
    it(`validates 129 materializable host tools before provider capping (${malformedLast})`, async () => {
      const names = Array.from({ length: 129 }, (_, i) => `work_${String(i).padStart(3, "0")}`);
      const tools = Object.fromEntries(names.map((name, i) => [name, {
        ...syntheticHostTool(),
        ...(i % 2 === 0
          ? { inputSchema: undefined, inputSchemaJson: { type: "object" as const, properties: {} } }
          : {}),
        ...(malformedLast && i === 128 ? { execute: undefined } : {}),
      }]));
      let visible: string[] = [];
      const f = fixture({
        grant: { ...grant, allowedToolNames: names, hostToolFacadeIds: ["local"] },
        facades: {
          hostTools: new Map([["local", tools]]),
          resolveModelRuntime: () => ({
            ...model,
            doStream: (options) => {
              visible = (options as ModelRuntimeCallOptions).tools?.map((tool) => tool.name) ?? [];
              return finishStream();
            },
          }),
        },
      });
      try {
        if (malformedLast) {
          assertEquals(await prepare(f.owner), {
            ok: false,
            code: "EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE",
          });
        } else {
          await Array.fromAsync(await preparedStream(f));
          assertEquals(visible, names.slice(0, 128));
        }
      } finally {
        await f.owner.close();
      }
    });
  }
});
