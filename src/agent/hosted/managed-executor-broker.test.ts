import { createTrustedManagedExecutorBroker } from "../service/trusted-managed-broker.ts";
import {
  type ExecutorRuntimeInstall,
  getExecutorRuntimeInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { HostedExecutorSessionOptions } from "./executor-session.ts";
import type { HostedExecutorAllocation } from "./executor-session-schema.ts";
import type { ExecutorNodeTransport } from "./executor-node-transport.ts";
import {
  createManagedExecutorBroker,
  type ManagedExecutorStartInput,
} from "./managed-executor-broker.ts";
import { getExecutorRuntimePrepareResultSchema } from "./executor-runtime-prepare-schema.ts";
import { readExecutorInitialCheckpoints } from "./executor-checkpoint-state.ts";
import { executorStateOperations } from "./executor-state-schema.ts";
import { createManagedBrokerPersistence } from "./managed-broker-persistence.ts";
import { FakeTime } from "#std/testing/time";
import { agent } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { createExecutorRuntimeInstallation } from "./executor-runtime-install.ts";
import { createExecutorRuntimeFacades } from "./executor-runtime-facades.ts";
import { createExecutorDiscovery } from "./executor-discovery.ts";
import { createExecutorRuntimePreparation } from "./executor-runtime-prepare.ts";
import { createExecutorProjectToolRuntime } from "./executor-project-runtime.ts";
import { tool } from "#veryfront/tool/factory.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { createTrustedManagedRuntime } from "./trusted-managed-runtime.ts";
import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";

const modelId = "veryfront-cloud/openai/synthetic";
const owner = { scopeKind: "project" as const, projectId: "project-test" };
const source = { type: "release" as const, releaseId: "release-test" };
const image = `registry.example.test/executor@sha256:${"a".repeat(64)}`;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function runtimeModel(): ModelRuntime {
  return {
    specificationVersion: "v2",
    provider: "veryfront-cloud",
    modelId: "synthetic",
    doGenerate: () => Promise.resolve({ content: [], finishReason: "stop", usage: {} }),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
  };
}

function fixture(
  options: {
    completeStream?: boolean;
    agentId?: string;
    prepareFailure?: boolean;
    prepareModelId?: string;
    brokerReadWait?: boolean;
    initialCheckpoint?: boolean;
    allocationLifetimeMs?: number;
    hardDeadlineMs?: number;
  } = {},
) {
  const now = Date.now();
  const request = {
    allocationId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
    owner,
    source,
    requestedAt: now,
    prepareDeadlineAt: now + 10_000,
    hardDeadlineAt: now + (options.hardDeadlineMs ?? 60_000),
  };
  const calls: string[] = [];
  let peer: ReturnType<typeof createExecutorChannel> | undefined;
  let generation = 0;
  let preparationDenied = false;
  let executionAllowed = false;
  let installed: ExecutorRuntimeInstall | undefined;
  let initialCheckpointRead = false;
  const preparation = new AbortController();
  const prepareEntered = Promise.withResolvers<void>();
  const prepareRelease = Promise.withResolvers<void>();
  const allocator: HostedExecutorSessionOptions["allocator"] = {
    allocate() {
      calls.push("allocate");
      generation = 1;
      return Promise.resolve(allocation("ready"));
    },
    observe() {
      calls.push("observe");
      return Promise.resolve(allocation("ready"));
    },
    renew() {
      calls.push("renew");
      return Promise.resolve(allocation("ready"));
    },
    release(_binding, reason) {
      calls.push(`release:${reason}`);
      return Promise.resolve(allocation("released", reason));
    },
  };
  function allocation(
    phase: "ready" | "released",
    reason?: "completed" | "canceled",
  ): HostedExecutorAllocation {
    return {
      binding: {
        allocationId: request.allocationId,
        invocationId: request.invocationId,
        owner,
        source,
        generation,
        brokerInstanceId: "broker-test",
      },
      phase,
      expiresAt: now + (options.allocationLifetimeMs ?? 30_000),
      ...(reason ? { reason } : {}),
      ...(phase === "ready"
        ? {
          endpoint: {
            address: "192.0.2.10",
            port: 8081,
            podUid: "pod-test",
            nodeName: "node-test",
            image,
            channelAuthenticated: false,
          },
        }
        : {}),
    };
  }
  const session: ManagedExecutorStartInput["session"] = {
    request,
    expectedBrokerInstanceId: "broker-test",
    expectedImage: image,
    allocator,
    preparationSignal: preparation.signal,
    pollIntervalMs: 1_000,
    requestTimeoutMs: 1_000,
    cleanupTimeoutMs: 50,
    connectTransport(input): Promise<ExecutorNodeTransport> {
      calls.push("connect");
      const outbound = new TransformStream<Uint8Array, Uint8Array>();
      const inbound = new TransformStream<Uint8Array, Uint8Array>();
      const operations = new Map<string, ExecutorOperation>([
        ["runtime.install", {
          mode: "unary",
          async handle(value) {
            installed = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), value);
            calls.push("install");
            try {
              await peer!.request("model.generate", { modelId, options: { prompt: [] } });
            } catch {
              preparationDenied = true;
            }
            if (options.initialCheckpoint) {
              const state = await readExecutorInitialCheckpoints({
                channel: peer!,
                capabilityIds: { toolExposureCheckpoint: "tool-checkpoint" },
              });
              initialCheckpointRead = state.initialToolExposureCheckpoint?.loadedToolNames[0] ===
                "search";
            }
            return { installed: true };
          },
        }],
        ["agent.describe", {
          mode: "unary",
          handle() {
            calls.push("describe");
            return {
              ok: true,
              value: {
                source,
                definition: {
                  id: options.agentId ?? "coder",
                  name: "Coder",
                  description: "Codes",
                  instructions: "Work",
                },
              },
            };
          },
        }],
        ["runtime.prepare", {
          mode: "unary",
          async handle(): Promise<JsonValue> {
            calls.push("prepare");
            if (options.brokerReadWait) {
              await peer!.request(executorStateOperations.latestConversationUserText, {
                capabilityId: "conversation-text",
              });
            }
            if (options.prepareFailure) {
              return { ok: false, code: "EXECUTOR_RUNTIME_PREPARATION_FAILED" };
            }
            return {
              ok: true,
              value: {
                preparedRuntimeHandle: "prepared-1",
                runtimeKind: "framework",
                modelId: options.prepareModelId ?? modelId,
              },
            };
          },
        }],
        ["agent.stream", {
          mode: "stream",
          async *handle(): AsyncGenerator<JsonValue> {
            calls.push("stream");
            await peer!.request("model.generate", {
              modelId,
              options: { prompt: [], maxOutputTokens: installed!.grant.models[0]!.maxOutputTokens },
            });
            executionAllowed = true;
            yield { type: "ready" };
            if (options.completeStream) {
              yield { type: "event", event: { type: "message-finish" } };
              yield { type: "complete" };
              return;
            }
            await new Promise(() => {});
          },
        }],
      ]);
      peer = createExecutorChannel({
        binding: input.binding,
        transport: { readable: outbound.readable, writable: inbound.writable },
        operations,
      });
      return Promise.resolve({
        readable: inbound.readable,
        writable: outbound.writable,
        close() {
          peer?.close();
        },
      });
    },
  };
  const installation: ManagedExecutorStartInput["installation"] = {
    version: 1,
    owner,
    source,
    root: "project",
    grant: {
      agentId: "coder",
      defaultModelId: modelId,
      maxSteps: 5,
      models: [{ id: modelId, maxOutputTokens: 100, providerToolNames: [] }],
      allowedToolNames: [],
      hostToolFacadeIds: [],
      remoteToolSourceIds: [],
      execution: { kind: "ephemeral", projectId: null },
    },
    capabilities: { persistence: {} },
  };
  const input: ManagedExecutorStartInput = {
    session,
    installation,
    prepare: { agentId: "coder" },
    model: {
      resolver: (id) => id === modelId ? runtimeModel() : undefined,
      grant: {
        maxCalls: 4,
        maxConcurrentCalls: 1,
        models: new Map([[modelId, { maxOutputTokens: 100, providerTools: [] }]]),
      },
    },
    tools: { catalog: new Map(), sources: new Map(), maxCalls: 4, maxConcurrent: 1 },
    persistence: {},
    state: {},
  };
  if (options.initialCheckpoint) {
    installation.capabilities.persistence.toolExposureCheckpoint = "tool-checkpoint";
    input.persistence = {
      initialToolExposureCheckpoint: { version: 2, loadedToolNames: ["search"] },
      persistToolExposureCheckpoint: () => Promise.resolve(),
    };
  }
  if (options.brokerReadWait) {
    installation.capabilities.conversationUserText = "conversation-text";
    input.state = {
      latestConversationUserText: async () => {
        prepareEntered.resolve();
        await prepareRelease.promise;
        return "late text";
      },
    };
  }
  return {
    calls,
    input,
    preparation,
    prepareEntered: prepareEntered.promise,
    releasePrepare: prepareRelease.resolve,
    get installed() {
      return installed;
    },
    get peer() {
      return peer;
    },
    get preparationDenied() {
      return preparationDenied;
    },
    get executionAllowed() {
      return executionAllowed;
    },
    get initialCheckpointRead() {
      return initialCheckpointRead;
    },
  };
}

function configureCanonical(
  input: ManagedExecutorStartInput,
  runEventSink: NonNullable<ManagedExecutorStartInput["model"]["runEventSink"]>,
  bindSessionOwnedWork?: ManagedExecutorStartInput["bindSessionOwnedWork"],
): void {
  input.installation.grant.execution = {
    kind: "canonical",
    projectId: null,
    conversationId: "conversation-1",
    runId: "run-1",
    messageId: "message-1",
    providerReplay: "disabled",
  };
  input.installation.capabilities.persistence = {
    publishParentRunEvents: "parent-events",
    toolExposureCheckpoint: "tool-checkpoint",
  };
  input.persistence = {
    publishParentRunEvents: () => Promise.resolve(),
    persistToolExposureCheckpoint: () => Promise.resolve(),
  };
  input.model.runEventSink = runEventSink;
  if (bindSessionOwnedWork) input.bindSessionOwnedWork = bindSessionOwnedWork;
}

describe("managed executor broker", () => {
  it("executes an owned host tool selected by its short alias through installed runtime facades", async () => {
    const f = fixture();
    const model = scriptedModel([
      { toolCalls: [{ id: "call", name: "owned-paper", input: {} }] },
      { text: "Complete" },
    ], { only: "stream", modelId: "synthetic", provider: "openai" });
    const executions: string[] = [];
    f.input.model.resolver = () => model;
    f.input.installation.grant.allowedToolNames = ["fetch-paper"];
    f.input.installation.grant.hostToolFacadeIds = ["host"];
    f.input.tools.catalog = new Map([
      ["fetch-paper", {}],
      ["owned-paper", { ownerAgentId: "coder", shortName: "fetch-paper" }],
    ]);
    f.input.tools.sources = new Map([["host", {
      allowedToolNames: new Set(["owned-paper"]),
      context: {},
      source: {
        id: "host",
        listTools: () =>
          Promise.resolve([{
            name: "owned-paper",
            description: "Read a synthetic paper",
            parameters: { type: "object", properties: {} },
          }]),
        executeTool: (name) => {
          executions.push(name);
          return Promise.resolve({ text: "Synthetic paper" });
        },
      },
    }]]);
    f.input.session.connectTransport = ({ binding }) => {
      const outbound = new TransformStream<Uint8Array, Uint8Array>();
      const inbound = new TransformStream<Uint8Array, Uint8Array>();
      const installation = createExecutorRuntimeInstallation({
        binding,
        artifact: { version: 1, owner, source, root: "project" },
        async install(input, signal) {
          const facades = await createExecutorRuntimeFacades({ input, channel: peer, signal });
          const discovery = createExecutorDiscovery({
            binding,
            source,
            projectDir: "/synthetic-project",
            signal,
            backend: {
              load: () =>
                Promise.resolve({
                  agents: new Map([[
                    "coder",
                    agent({
                      id: "coder",
                      model: modelId,
                      system: "Synthetic instructions",
                      tools: { "fetch-paper": true },
                    }),
                  ]]),
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
                }),
              cleanup: () => Promise.resolve(),
            },
          });
          return createExecutorRuntimePreparation({
            binding,
            source,
            facades,
            discovery,
            grant: {
              ...input.grant,
              models: new Map(input.grant.models.map(({ id, ...policy }) => [id, policy])),
            },
          });
        },
      });
      const peer = createExecutorChannel({
        binding,
        transport: { readable: outbound.readable, writable: inbound.writable },
        operations: installation.operations,
      });
      return Promise.resolve({
        readable: inbound.readable,
        writable: outbound.writable,
        async close() {
          await installation.close();
          peer.close();
          await peer.settled;
        },
      });
    };
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
    try {
      runtime = await broker.start(f.input);
      runtime.accept({ kind: "execution" });
      const stream = await runtime.agent.stream({
        messages: [{
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "Read" }],
          timestamp: 1,
        }],
        abortSignal: new AbortController().signal,
      });
      const events = await Array.fromAsync(stream.toUIMessageStream());
      assertEquals(model.toolNames(), ["owned-paper"]);
      assertEquals(executions, ["owned-paper"]);
      assertEquals(model.callCount, 2);
      assert(events.some((event) => event.type === "finish"));
    } finally {
      await runtime?.close();
      await broker.shutdown();
      await broker.settled;
    }
  });

  for (const mismatch of ["output tokens", "provider tools", "tool allowlist", "tool source"]) {
    it(`rejects a broker ${mismatch} grant broader than its installation before allocation`, async () => {
      const f = fixture();
      if (mismatch === "output tokens") {
        f.input.model.grant.models.get(modelId)!.maxOutputTokens = 101;
      } else if (mismatch === "provider tools") {
        f.input.model.grant.models.get(modelId)!.providerTools = [{
          type: "provider",
          name: "web_search",
          id: "openai.web_search",
          args: {},
        }];
      } else {
        if (mismatch === "tool source") f.input.installation.grant.allowedToolNames = ["ungranted"];
        else f.input.installation.grant.remoteToolSourceIds = ["synthetic"];
        f.input.tools.catalog = new Map([["ungranted", {}]]);
        f.input.tools.sources = new Map([["synthetic", {
          source: {
            id: "synthetic",
            listTools: () => Promise.resolve([]),
            executeTool: () => Promise.resolve({ result: "unexpected" }),
          },
          allowedToolNames: new Set(["ungranted"]),
          context: {},
        }]]);
      }
      const broker = createManagedExecutorBroker({ maxActive: 1 });
      let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
      try {
        await assertRejects(
          async () => {
            runtime = await broker.start(f.input);
          },
          TypeError,
          "exceeds the installed",
        );
        assertEquals(f.calls, []);
        assertEquals(broker.active, 0);
      } finally {
        await runtime?.close();
        await broker.shutdown();
        await broker.settled;
      }
    });
  }

  it("applies narrower broker model grants to preparation and completed generation", async () => {
    const f = fixture({ completeStream: true });
    f.input.installation.grant.models[0]!.maxOutputTokens = 200;
    f.input.installation.grant.models[0]!.providerToolNames = ["web_search", "web_fetch"];
    f.input.model.grant.models.get(modelId)!.providerTools = [{
      type: "provider",
      name: "web_search",
      id: "openai.web_search",
      args: {},
    }];
    f.input.installation.grant.allowedToolNames = ["inspect"];
    f.input.tools.catalog = new Map([["inspect", {}]]);
    f.input.installation.grant.remoteToolSourceIds = ["synthetic"];
    f.input.tools.sources = new Map([["synthetic", {
      source: {
        id: "synthetic",
        listTools: () => Promise.resolve([]),
        executeTool: () => Promise.resolve({ result: "done" }),
      },
      allowedToolNames: new Set(["inspect"]),
      context: {},
    }]]);
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
    try {
      runtime = await broker.start(f.input);
      runtime.accept({ kind: "execution" });
      const stream = await runtime.agent.stream({
        messages: [],
        abortSignal: new AbortController().signal,
      });
      await Array.fromAsync(stream.toUIMessageStream());
      assertEquals(f.installed!.grant.models[0]!.maxOutputTokens, 100);
      assertEquals(f.installed!.grant.models[0]!.providerToolNames, ["web_search"]);
      assertEquals(f.input.installation.grant.models[0]!.maxOutputTokens, 200);
      assertEquals(f.executionAllowed, true);
    } finally {
      await runtime?.close();
      await broker.shutdown();
      await broker.settled;
    }
  });

  for (
    const [agentId, selector, capabilityName, accepted] of [
      ["coder", "fetch-paper", "coder--fetch-paper", true],
      ["coder", "fetch-paper", "owned-paper", true],
      ["research.coder", "fetch-paper", "research_coder--fetch-paper", true],
      ["coder", "fetch-paper", "writer--fetch-paper", false],
      ["coder", "coder--fetch-paper", "writer--fetch-paper", false],
      ["coder", "coder--fetch-paper", "fetch-paper", false],
    ] as const
  ) {
    it(`${accepted ? "accepts" : "rejects"} capability ${capabilityName} for ${agentId}'s ${selector} grant`, async () => {
      const f = fixture({ agentId });
      f.input.installation.grant.agentId = agentId;
      f.input.prepare.agentId = agentId;
      f.input.installation.grant.allowedToolNames = [selector];
      f.input.tools.catalog = new Map([
        ["fetch-paper", {}],
        ["coder--fetch-paper", { ownerAgentId: "coder", shortName: "fetch-paper" }],
        ["research_coder--fetch-paper", {
          ownerAgentId: "research.coder",
          shortName: "fetch-paper",
        }],
        ["writer--fetch-paper", { ownerAgentId: "writer", shortName: "fetch-paper" }],
      ]);
      if (capabilityName === "owned-paper") {
        f.input.tools.catalog = new Map([
          ["fetch-paper", {}],
          ["owned-paper", { ownerAgentId: "coder", shortName: "fetch-paper" }],
        ]);
      }
      f.input.installation.grant.remoteToolSourceIds = ["synthetic"];
      f.input.tools.sources = new Map([["synthetic", {
        source: {
          id: "synthetic",
          listTools: () => Promise.resolve([]),
          executeTool: () => Promise.resolve({ result: "done" }),
        },
        allowedToolNames: new Set([capabilityName]),
        context: {},
      }]]);
      const broker = createManagedExecutorBroker({ maxActive: 1 });
      let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
      try {
        if (accepted) {
          runtime = await broker.start(f.input);
          assertEquals(f.calls.includes("allocate"), true);
          assertEquals(f.installed!.grant.allowedToolNames, [capabilityName]);
        } else {
          await assertRejects(
            async () => {
              runtime = await broker.start(f.input);
            },
            TypeError,
            "exceeds the installed",
          );
          assertEquals(f.calls, []);
        }
      } finally {
        await runtime?.close();
        await broker.shutdown();
        await broker.settled;
      }
    });
  }

  it("rejects a global broker capability shadowed by an owned project-local tool", async () => {
    const f = fixture();
    f.input.installation.grant.allowedToolNames = ["fetch-paper"];
    f.input.installation.grant.remoteToolSourceIds = ["synthetic"];
    f.input.tools.catalog = new Map([
      ["fetch-paper", {}],
      ["owned-paper", { ownerAgentId: "coder", shortName: "fetch-paper" }],
    ]);
    f.input.tools.sources = new Map([["synthetic", {
      source: {
        id: "synthetic",
        listTools: () => Promise.resolve([]),
        executeTool: () => Promise.resolve({ result: "unexpected" }),
      },
      allowedToolNames: new Set(["fetch-paper"]),
      context: {},
    }]]);
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
    try {
      await assertRejects(
        async () => {
          runtime = await broker.start(f.input);
        },
        TypeError,
        "exceeds the installed",
      );
      assertEquals(f.calls, []);
    } finally {
      await runtime?.close();
      await broker.shutdown();
      await broker.settled;
    }
  });

  for (const selectOtherModel of [false, true]) {
    it(`authorizes only the selected model's effective provider tools for steering (${selectOtherModel})`, async () => {
      const otherModelId = "veryfront-cloud/anthropic/synthetic";
      const selectedModelId = selectOtherModel ? otherModelId : modelId;
      const selectedTool = selectOtherModel ? "web_fetch" : "web_search";
      const rejectedTool = selectOtherModel ? "web_search" : "web_fetch";
      const f = fixture({ prepareModelId: selectedModelId });
      if (selectOtherModel) f.input.prepare.modelId = selectedModelId;
      f.input.installation.grant.models = [modelId, otherModelId].map((id) => ({
        id,
        maxOutputTokens: 100,
        providerToolNames: ["web_search", "web_fetch"],
      }));
      f.input.model.grant.models = new Map([
        [modelId, {
          maxOutputTokens: 100,
          providerTools: [{
            type: "provider",
            name: "web_search",
            id: "openai.web_search",
            args: {},
          }],
        }],
        [otherModelId, {
          maxOutputTokens: 100,
          providerTools: [{
            type: "provider",
            name: "web_fetch",
            id: "anthropic.web_fetch",
            args: {},
          }],
        }],
      ]);
      f.input.installation.capabilities.projectSteering = "steering";
      f.input.state.prepareProjectSteering = ({ definition }) =>
        Promise.resolve({ agent: definition });
      const selections: (readonly string[] | undefined)[] = [];
      f.input.state.refreshProjectSteering = (_signal, names) => {
        selections.push(names);
        return Promise.resolve("Refreshed");
      };
      const broker = createManagedExecutorBroker({ maxActive: 1 });
      const runtime = await broker.start(f.input);
      try {
        runtime.accept({ kind: "execution" });
        assertEquals(
          await f.peer!.request(executorStateOperations.refreshProjectSteering, {
            capabilityId: "steering",
            availableToolNames: [selectedTool],
          }),
          "Refreshed",
        );
        for (const tool of [rejectedTool, "ungranted_host_tool"]) {
          await assertRejects(() =>
            f.peer!.request(executorStateOperations.refreshProjectSteering, {
              capabilityId: "steering",
              availableToolNames: [tool],
            })
          );
        }
        assertEquals(selections, [[selectedTool]]);
      } finally {
        await runtime.close();
        await broker.shutdown();
        await broker.settled;
      }
    });
  }

  it("uses owner-scoped tool grants for steering refresh authorization", async () => {
    const f = fixture();
    f.input.installation.grant.allowedToolNames = ["fetch-paper"];
    f.input.tools.catalog = new Map([
      ["fetch-paper", {}],
      ["coder--fetch-paper", { ownerAgentId: "coder", shortName: "fetch-paper" }],
    ]);
    f.input.installation.capabilities.projectSteering = "steering";
    f.input.state.prepareProjectSteering = ({ definition }) =>
      Promise.resolve({ agent: definition });
    let selection: readonly string[] | undefined;
    f.input.state.refreshProjectSteering = (_signal, names) => {
      selection = names;
      return Promise.resolve("Refreshed");
    };
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    const runtime = await broker.start(f.input);
    try {
      runtime.accept({ kind: "execution" });
      assertEquals(
        await f.peer!.request(executorStateOperations.refreshProjectSteering, {
          capabilityId: "steering",
          availableToolNames: ["coder--fetch-paper"],
        }),
        "Refreshed",
      );
      assertEquals(selection, ["coder--fetch-paper"]);
      assertEquals(f.installed!.grant.allowedToolNames, ["coder--fetch-paper"]);
      await assertRejects(() =>
        f.peer!.request(executorStateOperations.refreshProjectSteering, {
          capabilityId: "steering",
          availableToolNames: ["fetch-paper"],
        })
      );
      await assertRejects(() =>
        f.peer!.request(executorStateOperations.refreshProjectSteering, {
          capabilityId: "steering",
          availableToolNames: ["writer--fetch-paper"],
        })
      );
      assertEquals(selection, ["coder--fetch-paper"]);
    } finally {
      await runtime.close();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("installs, discovers, prepares, accepts, and begins execution in exact order", async () => {
    const f = fixture({ initialCheckpoint: true });
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    let admitted = false;
    const pending = broker.start(f.input, {
      onAdmitted(settled) {
        admitted = true;
        assert(settled instanceof Promise);
      },
    });
    assertEquals(admitted, true);
    f.input.model.grant.models.get(modelId)!.maxOutputTokens = 1;
    f.input.persistence.initialToolExposureCheckpoint!.loadedToolNames[0] = "changed";
    const runtime = await pending;
    assertEquals(f.calls.slice(0, 5), ["allocate", "connect", "install", "describe", "prepare"]);
    assertEquals(f.preparationDenied, true);
    assertEquals(f.initialCheckpointRead, true);
    assertEquals(runtime.definition.id, "coder");
    await assertRejects(() =>
      runtime.agent.stream({ messages: [], abortSignal: new AbortController().signal })
    );
    runtime.accept({ kind: "execution" });
    await runtime.agent.stream({ messages: [], abortSignal: new AbortController().signal });
    assertEquals(f.executionAllowed, true);
    await runtime.close("completed");
    await runtime.settled;
    await f.peer?.closed;
    await broker.shutdown();
    await broker.settled;
    assertEquals(broker.active, 0);
  });

  it("rejects canonical model dispatch without a real event sink before allocation", async () => {
    const f = fixture();
    f.input.installation.grant.execution = {
      kind: "canonical",
      projectId: null,
      conversationId: "conversation-1",
      runId: "run-1",
      messageId: "message-1",
      providerReplay: "disabled",
    };
    f.input.installation.capabilities.persistence = {
      publishParentRunEvents: "parent-events",
      toolExposureCheckpoint: "tool-checkpoint",
    };
    f.input.persistence = {
      publishParentRunEvents: () => Promise.resolve(),
      persistToolExposureCheckpoint: () => Promise.resolve(),
    };
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    await assertRejects(() => broker.start(f.input));
    assertEquals(f.calls, []);
    assertEquals(broker.active, 0);
    await broker.shutdown();

    const ephemeral = fixture();
    ephemeral.input.model.runEventSink = () => Promise.resolve();
    const ephemeralBroker = createManagedExecutorBroker({ maxActive: 1 });
    await assertRejects(() => ephemeralBroker.start(ephemeral.input));
    assertEquals(ephemeral.calls, []);
    await ephemeralBroker.shutdown();
  });

  it("requires canonical session-work binding before allocation", async () => {
    const f = fixture();
    configureCanonical(f.input, () => Promise.resolve());
    const broker = createManagedExecutorBroker({ maxActive: 1 });

    await assertRejects(() => broker.start(f.input));
    assertEquals(f.calls, []);
    assertEquals(broker.active, 0);
    await broker.shutdown();
  });

  it("binds canonical persistence ownership immediately after pool admission", async () => {
    const f = fixture();
    configureCanonical(f.input, () => Promise.resolve(), (owner) => {
      f.calls.push("bind-owned-work");
      assertEquals(typeof owner, "function");
    });
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    const runtime = await broker.start(f.input);

    assertEquals(f.calls.slice(0, 3), ["allocate", "bind-owned-work", "connect"]);
    await runtime.close();
    await runtime.settled;
    await broker.shutdown();
  });

  it("closes and releases a session when remote preparation fails", async () => {
    const f = fixture({ prepareFailure: true });
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    await assertRejects(() => broker.start(f.input), Error, "EXECUTOR_RUNTIME_PREPARATION_FAILED");
    assert(f.calls.includes("release:canceled"));
    assertEquals(broker.active, 0);
    await f.peer?.closed;
    await broker.shutdown();
    await broker.settled;
  });

  it("rejects a prepared model outside the broker selection", async () => {
    const f = fixture({ prepareModelId: "veryfront-cloud/openai/other" });
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    await assertRejects(() => broker.start(f.input), Error, "EXECUTOR_RUNTIME_NOT_GRANTED");
    assert(f.calls.includes("release:canceled"));
    await broker.shutdown();
    await broker.settled;
  });

  it("returns preparation failure after bounded close while retaining noncooperative work", async () => {
    const f = fixture({ brokerReadWait: true });
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    const pending = broker.start(f.input);
    await f.prepareEntered;
    f.preparation.abort();
    await assertRejects(() => pending);
    assertEquals(broker.active, 1);
    const shutdown = broker.shutdown();
    f.releasePrepare();
    await shutdown;
    await broker.settled;
    assertEquals(broker.active, 0);
  });

  it("preserves request cancellation and transfers durable cancellation at acceptance", async () => {
    const requestFixture = fixture();
    const requestBroker = createManagedExecutorBroker({ maxActive: 1 });
    const requestRuntime = await requestBroker.start(requestFixture.input);
    requestRuntime.accept({ kind: "request" });
    requestFixture.preparation.abort();
    await requestRuntime.settled;
    assert(requestFixture.calls.includes("release:canceled"));
    await requestBroker.shutdown();

    const durableFixture = fixture();
    const durableBroker = createManagedExecutorBroker({ maxActive: 1 });
    const durableRuntime = await durableBroker.start(durableFixture.input);
    const execution = new AbortController();
    durableRuntime.accept({ kind: "execution", signal: execution.signal });
    durableFixture.preparation.abort();
    await tick();
    assertEquals(durableBroker.active, 1);
    execution.abort();
    await durableRuntime.settled;
    assert(durableFixture.calls.includes("release:canceled"));
    await durableBroker.shutdown();
  });

  it("retains pool admission until cancelled durable model persistence actually settles", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    f.input.installation.grant.execution = {
      kind: "canonical",
      projectId: null,
      conversationId: "conversation-1",
      runId: "run-1",
      messageId: "message-1",
      providerReplay: "disabled",
    };
    f.input.installation.capabilities.persistence = {
      publishParentRunEvents: "parent-events",
      toolExposureCheckpoint: "tool-checkpoint",
    };
    f.input.persistence = {
      publishParentRunEvents: () => Promise.resolve(),
      persistToolExposureCheckpoint: () => Promise.resolve(),
    };
    f.input.model.runEventSink = async () => {
      entered.resolve();
      await release.promise;
    };
    f.input.bindSessionOwnedWork = () => {};
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    const runtime = await broker.start(f.input);
    runtime.accept({ kind: "execution" });
    const opening = runtime.agent.stream({
      messages: [],
      abortSignal: new AbortController().signal,
    });
    void opening.catch(() => {});
    await entered.promise;
    await runtime.close();
    let settled = false;
    void runtime.settled.then(() => settled = true);
    await tick();
    assertEquals(settled, false);
    assertEquals(broker.active, 1);
    release.resolve();
    await assertRejects(() => opening);
    await runtime.settled;
    assertEquals(broker.active, 0);
    await f.peer?.closed;
    await broker.shutdown();
  });

  it("retains max-active admission for the original canonical append after its deadline", async () => {
    using time = new FakeTime();
    const f = fixture({ allocationLifetimeMs: 90_000, hardDeadlineMs: 120_000 });
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const messageId = "00000000-0000-4000-8000-000000000002";
    const appendEntered = Promise.withResolvers<void>();
    const appendRelease = Promise.withResolvers<Response>();
    const terminalCalls: Record<string, unknown>[] = [];
    let delayAuditAppend = true;
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (delayAuditAppend && Array.isArray(body.events)) {
        delayAuditAppend = false;
        appendEntered.resolve();
        return await appendRelease.promise;
      }
      terminalCalls.push(body);
      return Response.json({
        completed: true,
        run: { runId: "run-1", status: body.status },
      });
    };
    const persistence = createManagedBrokerPersistence({
      apiUrl: "https://api.example.test",
      runEventToken: "run-event-token",
      run: {
        runId: "run-1",
        conversationId,
        messageId,
        latestEventId: 0,
        latestExternalEventSequence: 0,
        waitingToolCallId: null,
        waitingToolName: null,
        status: "running",
        streamProtocolVersion: 2,
      },
      modelId,
      resolveProvider: () => "provider",
      fetch,
    });
    configureCanonical(
      f.input,
      persistence.modelRunEventSink,
      persistence.bindSessionOwnedWork,
    );
    f.input.installation.grant.execution = {
      kind: "canonical",
      projectId: null,
      conversationId,
      runId: "run-1",
      messageId,
      providerReplay: "disabled",
    };
    f.input.persistence = {
      publishParentRunEvents: persistence.publishParentRunEvents,
      persistToolExposureCheckpoint: persistence.persistToolExposureCheckpoint,
    };
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    const runtime = await broker.start(f.input);
    runtime.accept({ kind: "execution" });
    const opening = runtime.agent.stream({
      messages: [],
      abortSignal: new AbortController().signal,
    });
    await appendEntered.promise;

    await time.tickAsync(30_000);
    const openingResult = await Promise.allSettled([opening]);
    const streamError = openingResult[0]?.status === "rejected"
      ? openingResult[0].reason
      : undefined;
    assert(streamError instanceof Error);

    const finishResult = await Promise.allSettled([
      runtime.runOwned(() => persistence.output.finish({ completed: false, error: streamError })),
    ]);
    assertEquals(finishResult[0]?.status, "rejected");
    assertEquals(
      finishResult[0]?.status === "rejected" && finishResult[0].reason instanceof Error
        ? finishResult[0].reason.message
        : undefined,
      "Durable run event persistence timed out",
    );
    assertEquals(terminalCalls.length, 1);
    assertEquals(terminalCalls.at(-1)?.status, "failed");

    const closing = runtime.close();
    await time.tickAsync(50);
    await closing;
    let settled = false;
    void runtime.settled.then(() => settled = true);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    assertEquals(settled, false);
    assertEquals(broker.active, 1);

    const second = fixture();
    await assertRejects(() => broker.start(second.input));
    appendRelease.resolve(Response.json({
      latest_event_id: 1,
      latest_external_event_sequence: 1,
      appended_count: 1,
      run: {
        run_id: "run-1",
        conversation_id: conversationId,
        latest_event_id: 1,
        latest_external_event_sequence: 1,
      },
    }));
    await runtime.settled;
    await persistence.cleanup();
    assertEquals(broker.active, 0);

    const nextRuntime = await broker.start(second.input);
    await nextRuntime.close();
    await nextRuntime.settled;
    await broker.shutdown();
  });

  it("exports a strict preparation result schema", () => {
    assertEquals(
      getExecutorRuntimePrepareResultSchema().safeParse({
        ok: true,
        value: { preparedRuntimeHandle: "handle", runtimeKind: "framework", modelId },
      }).success,
      true,
    );
    assertEquals(
      getExecutorRuntimePrepareResultSchema().safeParse({
        ok: false,
        code: "EXECUTOR_RUNTIME_PREPARATION_FAILED",
      }).success,
      true,
    );
    assertEquals(
      getExecutorRuntimePrepareResultSchema().safeParse({
        ok: true,
        value: {
          preparedRuntimeHandle: "handle",
          runtimeKind: "framework",
          modelId,
          token: "secret",
        },
      }).success,
      false,
    );
  });
});

function trustedFixture(
  blockSteering?: Promise<void>,
  includeHost = false,
  projectExecute?: Tool["execute"],
  projectAliases?: { name: string; shortName: string }[],
) {
  const f = fixture({ allocationLifetimeMs: 120_000, hardDeadlineMs: 120_000 });
  const privateMarker = "synthetic-private-broker-runtime";
  const steeringEntered = Promise.withResolvers<void>();
  configureCanonical(f.input, () => Promise.resolve(), () => {});
  f.input.installation.grant.execution.projectId = "project-test";
  f.input.installation.capabilities.projectSteering = "steering";
  f.input.installation.grant.allowedToolNames = ["inspect"];
  f.input.installation.grant.remoteToolSourceIds = ["project"];
  f.input.tools.catalog = new Map([["inspect", {}]]);
  f.input.tools.maxCalls = 32;
  const trustedInput = Object.assign(f.input, {
    trustedRuntime: {
      projectToolNames: ["inspect"],
      sourceIntegrationPolicy: { schemaVersion: 1 as const, mode: "unrestricted" as const },
    },
  });
  f.input.state = {
    prepareProjectSteering: async ({ definition }) => {
      steeringEntered.resolve();
      await blockSteering;
      return { agent: definition, initialProjectInstructions: privateMarker };
    },
    refreshProjectSteering: () => privateMarker,
  };
  let hostCalls = 0;
  if (includeHost) {
    f.input.installation.grant.allowedToolNames.push("host-private");
    f.input.installation.grant.hostToolFacadeIds = ["host"];
    f.input.tools.catalog = new Map([["inspect", {}], ["host-private", {}]]);
    f.input.tools.sources = new Map([["host", {
      allowedToolNames: new Set(["host-private"]),
      context: {},
      source: {
        id: "host",
        listTools: () =>
          Promise.resolve([{
            name: "host-private",
            description: "Read broker-owned data",
            parameters: { type: "object", properties: {} },
          }]),
        executeTool: () => {
          hostCalls++;
          return Promise.resolve({ value: privateMarker });
        },
      },
    }]]);
  }
  const model = scriptedModel([
    ...(includeHost ? [{ toolCalls: [{ id: "host-call", name: "host-private", input: {} }] }] : []),
    { toolCalls: [{ id: "inspect-call", name: "inspect", input: { query: "approved" } }] },
    { text: privateMarker },
  ], { only: "stream" });
  f.input.model.resolver = () => model;
  let executions = 0;
  let projectWire = "";
  let peer: ReturnType<typeof createExecutorChannel> | undefined;
  let peerCleanup: Promise<void> = Promise.resolve();
  let installedProjectMode = false;
  f.input.session.connectTransport = ({ binding }) => {
    const decoder = new TextDecoder();
    const outbound = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        projectWire += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
    });
    const inbound = new TransformStream<Uint8Array, Uint8Array>();
    const installation = createExecutorRuntimeInstallation({
      mode: "project-tools",
      binding,
      artifact: { version: 1, owner, source, root: "project" },
      async install(input, signal, context) {
        installedProjectMode = input.mode === "project-tools";
        const registered = tool({
          id: "inspect",
          description: "Inspect an approved argument",
          inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
          execute: (args, call) => {
            executions++;
            assertEquals(args, { query: "approved" });
            assertEquals(call?.projectId, "project-test");
            assertEquals(call?.runId, "run-1");
            return projectExecute ? projectExecute(args, call) : { ok: true };
          },
        });
        const discovery = createExecutorDiscovery({
          binding,
          source,
          projectDir: "/synthetic-project",
          signal,
          backend: {
            load: () =>
              Promise.resolve({
                agents: new Map([[
                  "coder",
                  agent({
                    id: "coder",
                    model: modelId,
                    system: "Use the project tool",
                    tools: includeHost ? { inspect: true, "host-private": true } : true,
                    skills: false,
                  }),
                ]]),
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
              }),
            cleanup: () => Promise.resolve(),
          },
        });
        const runtime = await createExecutorProjectToolRuntime({
          input,
          discovery,
          signal,
          deadline: context.deadline,
        });
        if (projectAliases) {
          return {
            ...runtime,
            operations: new Map([...runtime.operations, ["project.tool-aliases", {
              mode: "unary",
              handle: () => ({ agentId: "coder", aliases: projectAliases }),
            }]]),
          };
        }
        return runtime;
      },
    });
    peer = createExecutorChannel({
      binding,
      transport: { readable: outbound.readable, writable: inbound.writable },
      operations: installation.operations,
    });
    return Promise.resolve({
      readable: inbound.readable,
      writable: outbound.writable,
      close() {
        peer?.close();
        peerCleanup = installation.close();
        void peerCleanup.catch(() => {});
      },
    });
  };
  return {
    ...f,
    input: trustedInput,
    privateMarker,
    model,
    steeringEntered: steeringEntered.promise,
    get hostCalls() {
      return hostCalls;
    },
    get executions() {
      return executions;
    },
    get projectWire() {
      return projectWire;
    },
    get projectPeer() {
      return peer;
    },
    get peerCleanup() {
      return peerCleanup;
    },
    get installedProjectMode() {
      return installedProjectMode;
    },
  };
}

async function drainTrustedFixture(f: ReturnType<typeof trustedFixture>) {
  const broker = createTrustedManagedExecutorBroker({ maxActive: 1 });
  let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
  try {
    runtime = await broker.start(f.input);
    runtime.accept({ kind: "execution" });
    const stream = await runtime.agent.stream({
      messages: [{
        id: "user",
        role: "user",
        parts: [{ type: "text", text: "Complete the task" }],
        timestamp: 1,
      }],
      abortSignal: new AbortController().signal,
    });
    return await Array.fromAsync(stream.toUIMessageStream());
  } finally {
    await runtime?.close("completed");
    await broker.shutdown();
    await broker.settled;
    await f.peerCleanup;
  }
}

async function withTrustedToolOperations(
  f: ReturnType<typeof trustedFixture>,
  test: (
    execute: (sourceId: string, signal?: AbortSignal) => Promise<JsonValue[]>,
  ) => Promise<void>,
) {
  let local: Awaited<ReturnType<typeof createTrustedManagedRuntime>> | undefined;
  let binding: ExecutorBinding | undefined;
  const broker = createManagedExecutorBroker({ maxActive: 1 }, async (options) => {
    binding = options.binding;
    local = await createTrustedManagedRuntime(options);
    return local;
  });
  let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
  try {
    runtime = await broker.start(f.input);
    runtime.accept({ kind: "execution" });
    assert(local && binding);
    local.gate.beginExecution();
    const operation = local.gate.operations.get("tool.execute");
    assert(operation?.mode === "stream");
    const fixedBinding = binding;
    await test((sourceId, signal = new AbortController().signal) =>
      Array.fromAsync(operation.handle({
        sourceId,
        toolName: sourceId === "project" ? "inspect" : "host-private",
        toolCallId: `${sourceId}-call`,
        args: sourceId === "project" ? { query: "approved" } : {},
      }, { binding: fixedBinding, signal, deadline: Date.now() + 10_000 }))
    );
  } finally {
    await runtime?.close("completed");
    await broker.shutdown();
    await broker.settled;
    await f.peerCleanup;
  }
}

describe("broker-local trusted runtime", () => {
  it("requires trusted runtime configuration in the public start type", () => {
    type Start = Parameters<ReturnType<typeof createTrustedManagedExecutorBroker>["start"]>[0];
    const required: undefined extends Start["trustedRuntime"] ? false : true = true;
    assertEquals(required, true);
  });

  it("carries approved identity and current skill availability across both channel hops", async () => {
    const observed: ToolExecutionContext[] = [];
    const f = trustedFixture(undefined, false, async (_args, call) => {
      assert(call);
      observed.push(call);
      return { ok: true };
    });
    f.input.installation.grant.execution.userId = "synthetic-user";
    f.input.installation.grant.execution.projectSlug = "synthetic-slug";
    await drainTrustedFixture(f);
    assertEquals(observed.length, 1);
    assertEquals(observed[0]!.userId, "synthetic-user");
    assertEquals(observed[0]!.projectSlug, "synthetic-slug");
    assertEquals(observed[0]!.activeSkillToolAvailability, {
      hasActiveSkill: false,
      references: [],
      scripts: [],
    });
    assertEquals(Object.hasOwn(observed[0]!, "authToken"), false);
    assert(f.projectWire.includes('"projectContext"'));
  });

  it("reserves project aliases within the combined host and project metadata budget", async () => {
    for (const includeAliases of [false, true]) {
      const aliases = includeAliases
        ? Array.from(
          { length: 30 },
          (_, index) => ({ name: "inspect", shortName: `inspect-alias-${index}` }),
        )
        : [];
      const f = trustedFixture(undefined, true, undefined, aliases);
      f.input.tools.sources.get("host")!.source.listTools = async () => [{
        name: "host-private",
        description: "x".repeat(3_000),
        parameters: { type: "object", properties: {} },
      }];
      f.input.tools.limits = { maxMetadataBytes: 4_096 };
      if (includeAliases) {
        let admitted = false;
        await assertRejects(() =>
          withTrustedToolOperations(f, async () => {
            admitted = true;
          })
        );
        assertEquals(admitted, false);
        assertEquals(f.executions, 0);
        assertEquals(f.hostCalls, 0);
      } else {
        await withTrustedToolOperations(f, async (execute) => {
          assertEquals(await execute("project"), [{ type: "result", result: { ok: true } }]);
          assertEquals(await execute("host"), [{
            type: "result",
            result: { value: f.privateMarker },
          }]);
        });
        assertEquals(f.executions, 1);
        assertEquals(f.hostCalls, 1);
      }
    }
  });

  it("shares concurrency between held host work and project calls", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = trustedFixture(undefined, true);
    const host = f.input.tools.sources.get("host")!;
    const original = host.source.executeTool;
    host.source.executeTool = async (...args) => {
      entered.resolve();
      await release.promise;
      return await original(...args);
    };
    await withTrustedToolOperations(f, async (execute) => {
      const first = execute("host");
      try {
        await entered.promise;
        assertEquals(await execute("project"), [{
          type: "failure",
          code: "RESOURCE_LIMIT_EXCEEDED",
        }]);
        assertEquals(f.executions, 0);
      } finally {
        release.resolve();
        await first;
      }
      assertEquals(await execute("project"), [{ type: "result", result: { ok: true } }]);
      assertEquals(f.executions, 1);
    });
  });

  it("holds shared concurrency until canceled project work actually settles", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = trustedFixture(undefined, true, async () => {
      entered.resolve();
      await release.promise;
      return { ok: true };
    });
    await withTrustedToolOperations(f, async (execute) => {
      const controller = new AbortController();
      const first = assertRejects(() => execute("project", controller.signal));
      try {
        await entered.promise;
        controller.abort();
        assertEquals(await execute("host"), [{ type: "failure", code: "RESOURCE_LIMIT_EXCEEDED" }]);
        assertEquals(f.hostCalls, 0);
      } finally {
        release.resolve();
        await first;
      }
      assertEquals(await execute("host"), [{ type: "result", result: { value: f.privateMarker } }]);
      assertEquals(f.hostCalls, 1);
    });
  });

  it("enforces tightened progress limits inside the project executor", async () => {
    const f = trustedFixture(undefined, false, async (_args, call) => {
      await call?.publishDataEvent?.({ type: "data-tool-progress", data: { text: "one" } });
      await call?.publishDataEvent?.({ type: "data-tool-progress", data: { text: "two" } });
      return { ok: true };
    });
    f.input.tools.limits = { maxProgressEvents: 1 };
    const events = await drainTrustedFixture(f);
    assertEquals(f.executions, 1);
    assert(
      events.some((event) =>
        event.type === "tool-output-error" && event.toolCallId === "inspect-call"
      ),
    );
    assertEquals(f.projectWire.includes('"text":"two"'), false);
  });

  it("shares one call allowance across host and project tools", async () => {
    const f = trustedFixture(undefined, true);
    f.input.tools.maxCalls = 6;
    await drainTrustedFixture(f);
    assertEquals(f.hostCalls, 1);
    assertEquals(f.executions, 0);
  });

  it("rejects oversized project arguments before they cross the project channel", async () => {
    const f = trustedFixture();
    f.input.tools.limits = { maxArgumentBytes: 8 };
    await drainTrustedFixture(f);
    assertEquals(f.executions, 0);
    assertEquals(f.projectWire.includes('"query":"approved"'), false);
  });

  it("enforces tightened project result limits", async () => {
    const f = trustedFixture();
    f.input.tools.limits = { maxResultBytes: 8 };
    const events = await drainTrustedFixture(f);
    assertEquals(f.executions, 1);
    assert(
      events.some((event) =>
        event.type === "tool-output-error" && event.toolCallId === "inspect-call"
      ),
    );
  });

  for (const limits of [{ maxSources: 1 }, { maxTotalTools: 1 }, { maxToolsPerSource: 1 }]) {
    it(`validates combined host/project inventory before allocation ${JSON.stringify(limits)}`, async () => {
      const f = trustedFixture(undefined, true);
      f.input.tools.limits = limits;
      if ("maxToolsPerSource" in limits) {
        assert(f.input.trustedRuntime);
        f.input.trustedRuntime.projectToolNames = ["inspect", "second"];
        f.input.installation.grant.allowedToolNames.push("second");
        f.input.tools.catalog = new Map([...f.input.tools.catalog, ["second", {}]]);
      }
      await assertRejects(() => drainTrustedFixture(f), TypeError, "Combined tool catalog");
      assertEquals(f.calls, []);
    });
  }
  for (const includeHost of [false, true]) {
    it(`keeps private instructions and output local with host tools ${includeHost}`, async () => {
      const f = trustedFixture(undefined, includeHost);
      const broker = createTrustedManagedExecutorBroker({ maxActive: 1 });
      let runtime: Awaited<ReturnType<typeof broker.start>> | undefined;
      try {
        runtime = await broker.start(f.input);
        assertEquals(f.installedProjectMode, true);
        await assertRejects(() => f.projectPeer!.request("model.prepare", {}));
        runtime.accept({ kind: "execution" });
        const stream = await runtime.agent.stream({
          messages: [{
            id: "user",
            role: "user",
            parts: [{ type: "text", text: "Complete the task" }],
            timestamp: 1,
          }],
          abortSignal: new AbortController().signal,
        });
        const events = await Array.fromAsync(stream.toUIMessageStream());
        assert(
          events.some((event) => event.type === "text-delta" && event.delta === f.privateMarker),
        );
        assert(events.some((event) => event.type === "finish"));
        assertEquals(f.executions, 1);
        assert(JSON.stringify(f.model.calls[0]?.prompt).includes(f.privateMarker));
        assertEquals(f.model.callCount, includeHost ? 3 : 2);
        assertEquals(f.hostCalls, includeHost ? 1 : 0);
        assertEquals(f.projectWire.includes(f.privateMarker), false);
        await assertRejects(() => f.projectPeer!.request("model.generate", {}));
        await assertRejects(() =>
          f.projectPeer!.request(executorStateOperations.refreshProjectSteering, {})
        );
        await assertRejects(() =>
          Array.fromAsync(f.projectPeer!.stream("tool.execute", {
            sourceId: "host",
            toolName: "host-private",
            toolCallId: "forged",
            args: {},
          }))
        );
        assertEquals(f.hostCalls, includeHost ? 1 : 0);
      } finally {
        await runtime?.close("completed");
        await broker.shutdown();
        await broker.settled;
        await f.peerCleanup;
      }
      assertEquals(broker.active, 0);
    });
  }
  it("requires a construction-time trusted entrypoint rather than a request-only mode switch", async () => {
    const f = trustedFixture();
    const broker = createManagedExecutorBroker({ maxActive: 1 });
    try {
      await assertRejects(() => broker.start(f.input), TypeError, "dedicated broker entrypoint");
      assertEquals(f.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });
  it("rejects project tool authority outside the normalized grant before allocation", async () => {
    const f = trustedFixture();
    Object.assign(f.input, {
      trustedRuntime: {
        projectToolNames: ["ungranted"],
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      },
    });
    const broker = createTrustedManagedExecutorBroker({ maxActive: 1 });
    try {
      await assertRejects(() => broker.start(f.input), TypeError, "normalized invocation grant");
      assertEquals(f.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });
  it("preserves admitted streaming beyond the default thirty-second channel timeout", async () => {
    using time = new FakeTime();
    const f = trustedFixture();
    const entered = Promise.withResolvers<void>();
    const firstText = Promise.withResolvers<void>();
    let controller: ReadableStreamDefaultController<unknown> | undefined;
    let providerSignal: AbortSignal | undefined;
    const model = scriptedModel([{ text: "unused" }], { only: "stream" });
    model.doStream = (options) => {
      providerSignal = options.abortSignal;
      return Promise.resolve({
        stream: new ReadableStream({
          start(value) {
            controller = value;
            value.enqueue({ type: "text-delta", text: "start" });
            entered.resolve();
          },
        }),
      });
    };
    f.input.model.resolver = () => model;
    const broker = createTrustedManagedExecutorBroker({ maxActive: 1 });
    const runtime = await broker.start(f.input);
    let consumed: Promise<void> = Promise.resolve();
    let consumptionError: unknown;
    try {
      runtime.accept({ kind: "execution" });
      const stream = await runtime.agent.stream({
        messages: [],
        abortSignal: new AbortController().signal,
      });
      consumed = (async () => {
        for await (const event of stream.toUIMessageStream()) {
          if (event.type === "text-delta") firstText.resolve();
        }
      })().catch((error) => {
        consumptionError = error;
      });
      await entered.promise;
      await firstText.promise;
      for (let index = 0; index < 4; index++) {
        controller!.enqueue({ type: "text-delta", text: "tick" });
        await time.tickAsync(9_000);
      }
      assertEquals(
        providerSignal?.aborted,
        false,
        "The admitted run must survive the channel default",
      );
      assertEquals(consumptionError, undefined);
      controller!.enqueue({ type: "finish", finishReason: "stop" });
      controller!.close();
      await consumed;
      assertEquals(consumptionError, undefined);
    } finally {
      const closing = runtime.close();
      await time.tickAsync(50);
      await closing;
      await broker.shutdown();
      await broker.settled;
      await consumed;
      await f.peerCleanup;
    }
  });
  it("returns bounded cancellation while retaining noncooperative broker-local preparation", async () => {
    const release = Promise.withResolvers<void>();
    const f = trustedFixture(release.promise);
    const broker = createTrustedManagedExecutorBroker({ maxActive: 1 });
    const starting = broker.start(f.input);
    const rejected = assertRejects(() => starting);
    await f.steeringEntered;
    f.preparation.abort();
    await rejected;
    assertEquals(broker.active, 1);
    release.resolve();
    await broker.shutdown();
    await broker.settled;
    await f.peerCleanup;
    assertEquals(broker.active, 0);
  });
});
