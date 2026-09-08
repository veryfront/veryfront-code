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
          async handle() {
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
                  id: "coder",
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
          async *handle() {
            calls.push("stream");
            await peer!.request("model.generate", {
              modelId,
              options: { prompt: [], maxOutputTokens: 100 },
            });
            executionAllowed = true;
            yield { type: "ready" };
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
    tools: { sources: new Map(), maxCalls: 4, maxConcurrent: 1 },
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
