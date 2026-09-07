import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorChannel } from "../executor/channel.ts";
import { ManualMonotonicClock } from "../streaming/lifecycle/testing.ts";
import {
  createHostedExecutorSession,
  createHostedExecutorSessionClock,
  type HostedExecutorAllocatorClient,
  type HostedExecutorSessionOptions,
} from "./executor-session.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  type HostedExecutorAllocation,
  type HostedExecutorOwner,
  readHostedExecutorBinding,
  sameHostedExecutorBinding,
} from "./executor-session-schema.ts";
import type { ExecutorNodeTransport } from "./executor-node-transport.ts";

const request = {
  allocationId: "11111111-1111-4111-8111-111111111111",
  invocationId: "22222222-2222-4222-8222-222222222222",
  owner: { scopeKind: "project" as const, projectId: "project-test" },
  source: { type: "release" as const, releaseId: "release-test" },
  requestedAt: 1000,
  prepareDeadlineAt: 4000,
  hardDeadlineAt: 11_000,
};
const binding = { ...request, generation: 7, brokerInstanceId: "broker-pod-test" };
const fullBinding = {
  allocationId: binding.allocationId,
  invocationId: binding.invocationId,
  generation: binding.generation,
  brokerInstanceId: binding.brokerInstanceId,
  owner: binding.owner,
  source: binding.source,
};
const image = `registry.example.test/executor@sha256:${"a".repeat(64)}`;

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function fixture(overrides: Partial<HostedExecutorSessionOptions> = {}) {
  const expectedRequest = structuredClone(overrides.request ?? request);
  const expectedBinding = { ...fullBinding, owner: expectedRequest.owner };
  const time = new ManualMonotonicClock();
  const clock = createHostedExecutorSessionClock(1000, time);
  const calls: string[] = [];
  const returned: HostedExecutorAllocation = {
    binding: expectedBinding,
    phase: "ready",
    expiresAt: 2000,
    endpoint: {
      address: "192.0.2.10",
      port: 8081,
      podUid: "pod-test",
      nodeName: "node-test",
      image,
      channelAuthenticated: false,
    },
  };
  let peer: ExecutorChannel | undefined;
  let allocatedKey: Uint8Array | undefined;
  let connectedKey: Uint8Array | undefined;
  let allocatedKeyCopy: Uint8Array | undefined;
  let transportSignal: AbortSignal | undefined;
  const allocator: HostedExecutorAllocatorClient = {
    allocate(input, bootstrap) {
      calls.push("allocate");
      assertEquals(input, expectedRequest);
      allocatedKey = bootstrap.channelKey;
      allocatedKeyCopy = new Uint8Array(allocatedKey);
      return Promise.resolve(structuredClone(returned));
    },
    observe(input) {
      calls.push("observe");
      assertEquals(input, expectedBinding);
      return Promise.resolve(structuredClone(returned));
    },
    renew(input) {
      calls.push("renew");
      assertEquals(input, expectedBinding);
      returned.expiresAt = Math.min(clock.now() + 1000, request.hardDeadlineAt);
      return Promise.resolve(structuredClone(returned));
    },
    release(input, reason) {
      calls.push(`release:${reason}`);
      assertEquals(input, expectedBinding);
      return Promise.resolve({
        binding: expectedBinding,
        phase: "released",
        expiresAt: returned.expiresAt,
        reason,
      });
    },
  };
  const options: HostedExecutorSessionOptions = {
    request: expectedRequest,
    expectedBrokerInstanceId: fullBinding.brokerInstanceId,
    expectedImage: image,
    allocator,
    clock,
    pollIntervalMs: 100,
    requestTimeoutMs: 300,
    cleanupTimeoutMs: 500,
    connectTransport(input) {
      calls.push("connect");
      assertEquals(input.binding, {
        allocationId: binding.allocationId,
        generation: 7,
        invocationId: binding.invocationId,
      });
      assertEquals(input.podIp, returned.endpoint!.address);
      assertEquals(input.timeoutMs, request.hardDeadlineAt - clock.now());
      connectedKey = input.key;
      assertEquals(connectedKey, allocatedKeyCopy);
      transportSignal = input.signal;
      const outbound = new TransformStream<Uint8Array, Uint8Array>();
      const inbound = new TransformStream<Uint8Array, Uint8Array>();
      peer = createExecutorChannel({
        binding: input.binding,
        transport: { readable: outbound.readable, writable: inbound.writable },
        operations: new Map([["echo", { mode: "unary", handle: (value) => value }]]),
      });
      return Promise.resolve({
        readable: inbound.readable,
        writable: outbound.writable,
        close() {
          calls.push("transport-close");
          peer!.close();
        },
      });
    },
    createOperations(input, signal) {
      calls.push("operations");
      assertEquals(input, expectedBinding);
      assertEquals(signal.aborted, false);
      return {
        operations: new Map(),
        revoke() {
          calls.push("revoke");
        },
      };
    },
    ...overrides,
  };
  return {
    time,
    clock,
    calls,
    returned,
    allocator,
    options,
    start: () => createHostedExecutorSession(options),
    get allocatedKey() {
      return allocatedKey;
    },
    get connectedKey() {
      return connectedKey;
    },
    get transportSignal() {
      return transportSignal;
    },
    get peer() {
      return peer;
    },
    async peerClosed() {
      await peer?.closed;
    },
  };
}

describe("hosted executor session", () => {
  it("owns a global metadata session without any application project", async () => {
    const owner: HostedExecutorOwner = { scopeKind: "global", serviceName: "@example/agent" };
    const f = fixture({ request: { ...request, owner } });
    const session = f.start();
    const channel = await session.ready;
    assertEquals(session.binding?.owner, owner);
    assertEquals(Object.hasOwn(f.options.request, "projectId"), false);
    assertEquals(Object.hasOwn(session.binding!, "projectId"), false);
    assertEquals(await channel.request("echo", { discovery: true }), { discovery: true });
    assertEquals((await session.close("completed")).release, "released");
    await session.settled;
    await f.peerClosed();
  });

  it("snapshots and freezes owner before allocator work and operation grants", async () => {
    const owner: HostedExecutorOwner = { scopeKind: "global", serviceName: "platform-agent" };
    const f = fixture({ request: { ...request, owner } });
    const allocate = f.allocator.allocate;
    f.allocator.allocate = (input, bootstrap, signal) => {
      assert(Object.isFrozen(input.owner));
      assertThrows(() => Object.assign(input.owner, { serviceName: "foreign" }), TypeError);
      return allocate(input, bootstrap, signal);
    };
    const session = f.start();
    owner.serviceName = "changed-after-start";
    await session.ready;
    assertEquals(session.binding?.owner, { scopeKind: "global", serviceName: "platform-agent" });
    assert(Object.isFrozen(session.binding?.owner));
    assertThrows(
      () => Object.assign(session.binding!.owner, { serviceName: "foreign" }),
      TypeError,
    );
    await session.close();
    await session.settled;
    await f.peerClosed();
  });

  for (
    const owner of [undefined, {}, { scopeKind: "global" }, { scopeKind: "project" }, {
      scopeKind: "global",
      serviceName: "",
    }, { scopeKind: "global", serviceName: "agent", projectId: "project" }]
  ) {
    it(`rejects missing or ambiguous allocation owner ${JSON.stringify(owner)}`, () => {
      assertEquals(
        getHostedExecutorAllocationRequestSchema().safeParse({ ...request, owner }).success,
        false,
      );
    });
  }

  it("does not interpret a legacy project or absent owner as global", () => {
    const { owner: _owner, ...rest } = request;
    assertEquals(
      getHostedExecutorAllocationRequestSchema().safeParse({ ...rest, projectId: "legacy-project" })
        .success,
      false,
    );
    assertEquals(getHostedExecutorAllocationRequestSchema().safeParse(rest).success, false);
  });

  it("compares scope and identity and freezes captured source ownership", () => {
    const owner: HostedExecutorOwner = { scopeKind: "global", serviceName: "platform-agent" };
    const captured = readHostedExecutorBinding({ binding: { ...fullBinding, owner } });
    owner.serviceName = "changed";
    assert(Object.isFrozen(captured.owner));
    assertEquals(captured.owner, { scopeKind: "global", serviceName: "platform-agent" });
    assertEquals(
      sameHostedExecutorBinding(captured, {
        ...captured,
        owner: { scopeKind: "project", projectId: "platform-agent" },
      }),
      false,
    );
    assertEquals(
      sameHostedExecutorBinding(captured, {
        ...captured,
        owner: { scopeKind: "global", serviceName: "another-service" },
      }),
      false,
    );
  });

  it("rejects a foreign release acknowledgement while keeping the original owner binding", async () => {
    const f = fixture({
      request: { ...request, owner: { scopeKind: "global", serviceName: "platform-agent" } },
    });
    f.allocator.release = (binding, reason) => {
      assertEquals(binding.owner, { scopeKind: "global", serviceName: "platform-agent" });
      return Promise.resolve({
        binding: { ...binding, owner: { scopeKind: "project", projectId: "platform-agent" } },
        phase: "released",
        reason,
        expiresAt: 2000,
      });
    };
    const session = f.start();
    await session.ready;
    assertEquals((await session.close()).release, "reaper-required");
    await session.settled;
    await f.peerClosed();
  });
  it("accepts explicit global discovery ownership without a project", () => {
    const parsed = getHostedExecutorAllocationRequestSchema().safeParse({
      allocationId: request.allocationId,
      invocationId: request.invocationId,
      owner: { scopeKind: "global", serviceName: "platform-agent" },
      source: request.source,
      requestedAt: request.requestedAt,
      prepareDeadlineAt: request.prepareDeadlineAt,
      hardDeadlineAt: request.hardDeadlineAt,
    });
    assertEquals(parsed.success, true);
  });
  it("anchors UTC deadlines to a monotonic elapsed clock", async () => {
    const time = new ManualMonotonicClock();
    time.advanceBy(50);
    const clock = createHostedExecutorSessionClock(1000, time);
    let expired = false;
    clock.schedule(() => {
      expired = true;
    }, 100);
    time.advanceBy(99);
    await tick();
    assertEquals(clock.now(), 1099);
    assertEquals(expired, false);
    time.advanceBy(1);
    await tick();
    assertEquals(clock.now(), 1100);
    assertEquals(expired, true);
  });
  it("owns one authenticated attachment and clears its allocation-only key", async () => {
    const f = fixture();
    const session = f.start();
    const channel = await session.ready;
    assertEquals(session.binding, fullBinding);
    assertEquals(await channel.request("echo", { synthetic: true }), { synthetic: true });
    assertEquals(f.allocatedKey, new Uint8Array(32));
    assertEquals(f.connectedKey, new Uint8Array(32));
    assertEquals(f.calls.slice(0, 3), ["allocate", "connect", "operations"]);
    assertEquals(await session.close("completed"), { reason: "completed", release: "released" });
    await f.peerClosed();
    assertEquals(f.calls.filter((call) => call === "connect").length, 1);
    assert(f.calls.indexOf("revoke") < f.calls.indexOf("release:completed"));
    assertEquals(f.clock.now(), 1000);
    assertEquals(f.time.pendingWaitCount, 0);
  });

  it("detaches preparation cancellation only on explicit execution acceptance", async () => {
    const preparation = new AbortController();
    const execution = new AbortController();
    const f = fixture({ preparationSignal: preparation.signal });
    const session = f.start();
    const channel = await session.ready;
    session.accept({ kind: "execution", signal: execution.signal });
    preparation.abort();
    assertEquals(session.signal.aborted, false);
    assertEquals(f.transportSignal?.aborted, false);
    assertEquals(await channel.request("echo", 1), 1);
    execution.abort();
    assertEquals((await session.closed).release, "released");
    await f.peerClosed();
    assertEquals(session.signal.aborted, true);
    assertEquals(f.transportSignal?.aborted, true);
  });

  it("keeps direct accepted sessions request-owned and keeps preparation deadline until acceptance", async () => {
    for (const accept of [false, true]) {
      const preparation = new AbortController();
      const f = fixture({ preparationSignal: preparation.signal });
      const session = f.start();
      await session.ready;
      if (accept) session.accept({ kind: "request" });
      preparation.abort();
      assertEquals((await session.closed).reason, "canceled");
      await f.peerClosed();
      assertThrows(() => session.accept({ kind: "execution" }), Error);
    }
  });

  it("renews the exact binding without replacing its transport", async () => {
    const f = fixture();
    const session = f.start();
    await session.ready;
    session.accept({ kind: "execution" });
    f.time.advanceBy(500);
    await tick();
    assert(f.calls.includes("renew"));
    assertEquals(f.calls.filter((call) => call === "connect").length, 1);
    await session.close();
    await f.peerClosed();
    assertEquals(f.time.pendingWaitCount, 0);
  });

  it("joins a late allocation identity during idempotent bounded cleanup", async () => {
    const deferred = Promise.withResolvers<unknown>();
    const f = fixture();
    f.allocator.allocate = () => deferred.promise;
    const session = f.start();
    const rejected = assertRejects(() => session.ready);
    const first = session.close();
    const second = session.close();
    deferred.resolve(structuredClone(f.returned));
    assertEquals(await first, { reason: "canceled", release: "released" });
    assertEquals(await second, await first);
    await rejected;
    assertEquals(f.calls.filter((call) => call === "release:canceled").length, 1);
    assertEquals(f.calls.includes("connect"), false);
  });

  it("reports reaper-required when an allocation remains ambiguous", async () => {
    const deferred = Promise.withResolvers<unknown>();
    const f = fixture();
    f.allocator.allocate = () => deferred.promise;
    const session = f.start();
    const rejected = assertRejects(() => session.ready);
    const closing = session.close();
    f.time.advanceBy(500);
    assertEquals(await closing, { reason: "canceled", release: "reaper-required" });
    await rejected;
    assertEquals(f.calls.some((call) => call.startsWith("release:")), false);
    deferred.resolve(structuredClone(f.returned));
    await tick();
    assertEquals(f.calls.includes("connect"), false);
    assertEquals(f.time.pendingWaitCount, 0);
  });

  it("closes a connection resolved just before preparation cancellation without adopting it", async () => {
    const preparation = new AbortController();
    const f = fixture({ preparationSignal: preparation.signal });
    const connect = f.options.connectTransport;
    const connection = Promise.withResolvers<ExecutorNodeTransport>();
    let transport: ExecutorNodeTransport | undefined;
    f.options.connectTransport = async (input) => {
      transport = await connect(input);
      return connection.promise;
    };
    const session = f.start();
    const rejected = assertRejects(() => session.ready);
    await tick();
    connection.resolve(transport!);
    await Promise.resolve();
    await Promise.resolve();
    preparation.abort();
    try {
      await rejected;
      await session.closed;
      assertEquals(f.calls.filter((call) => call === "transport-close").length, 1);
      assertEquals(f.calls.includes("operations"), false);
    } finally {
      transport?.close();
      await f.peerClosed();
    }
  });

  it("keeps preparation bounded after channel readiness and clears that deadline on acceptance", async () => {
    for (const accepted of [false, true]) {
      const f = fixture();
      f.returned.expiresAt = request.hardDeadlineAt;
      const session = f.start();
      await session.ready;
      if (accepted) session.accept({ kind: "execution" });
      f.time.advanceBy(request.prepareDeadlineAt - f.clock.now());
      await tick();
      if (accepted) {
        assertEquals(session.signal.aborted, false);
        await session.close();
      } else {
        assertEquals((await session.closed).reason, "preparation-timeout");
        assertThrows(() => session.accept({ kind: "execution" }), Error);
      }
      await f.peerClosed();
      assertEquals(f.time.pendingWaitCount, 0);
    }
  });

  it("keeps service ownership and the hard deadline after detached acceptance", async () => {
    for (const expire of [false, true]) {
      const owner = new AbortController();
      const f = fixture({ ownerSignal: owner.signal });
      f.returned.expiresAt = request.hardDeadlineAt;
      const session = f.start();
      await session.ready;
      session.accept({ kind: "execution" });
      if (expire) f.time.advanceBy(request.hardDeadlineAt - f.clock.now());
      else owner.abort();
      assertEquals((await session.closed).reason, expire ? "expired" : "canceled");
      await f.peerClosed();
    }
  });

  for (
    const field of [
      "allocationId",
      "invocationId",
      "brokerInstanceId",
      "owner",
      "source",
    ] as const
  ) {
    it(`rejects mismatched ${field} without releasing a guessed binding`, async () => {
      const f = fixture();
      const changed = field === "source"
        ? { type: "release", releaseId: "other-release" }
        : field === "owner"
        ? { scopeKind: "project", projectId: "other-project" }
        : field.endsWith("Id") && (field === "allocationId" || field === "invocationId")
        ? "33333333-3333-4333-8333-333333333333"
        : "other-identity";
      f.allocator.allocate = () =>
        Promise.resolve({ ...f.returned, binding: { ...fullBinding, [field]: changed } });
      const session = f.start();
      await assertRejects(() => session.ready, Error, "allocation-failed");
      assertEquals((await session.closed).release, "reaper-required");
      assertEquals(f.calls.some((call) => call.startsWith("release:")), false);
      assertEquals(f.calls.includes("connect"), false);
    });
  }

  for (
    const change of [
      { address: "executor.example.test" },
      { port: 443 },
      { podUid: "" },
      { image: "registry.example.test/executor:latest" },
      { image: `registry.example.test/executor@sha256:${"b".repeat(64)}` },
      { channelAuthenticated: true },
    ]
  ) {
    it(`rejects unverified endpoint ${Object.keys(change)[0]} and releases its validated binding`, async () => {
      const f = fixture();
      f.allocator.allocate = () =>
        Promise.resolve({ ...f.returned, endpoint: { ...f.returned.endpoint, ...change } });
      const session = f.start();
      await assertRejects(() => session.ready);
      assertEquals((await session.closed).release, "released");
      assertEquals(f.calls.includes("connect"), false);
      assertEquals(f.calls.filter((call) => call === "release:canceled").length, 1);
    });
  }

  for (const loss of ["policy", "lease", "pod", "generation", "image", "owner"] as const) {
    it(`revokes channel work on ${loss} loss and never reattaches`, async () => {
      const f = fixture();
      const session = f.start();
      const channel = await session.ready;
      session.accept({ kind: "execution" });
      if (loss === "lease") f.returned.expiresAt = 1000;
      if (loss === "pod") f.returned.endpoint!.podUid = "replacement-pod";
      if (loss === "generation") f.returned.binding = { ...fullBinding, generation: 8 };
      if (loss === "owner") {
        f.returned.binding = {
          ...fullBinding,
          owner: { scopeKind: "global", serviceName: "foreign-service" },
        };
      }
      if (loss === "image") {
        f.returned.endpoint!.image = `registry.example.test/executor@sha256:${"b".repeat(64)}`;
      }
      if (loss === "policy") {
        f.returned.phase = "terminating";
        f.returned.reason = "policy-unavailable";
        delete f.returned.endpoint;
      }
      f.time.advanceBy(100);
      await tick();
      assertEquals((await session.closed).release, "released");
      assertEquals(channel.signal.aborted, true);
      assertEquals(f.calls.filter((call) => call === "connect").length, 1);
      assert(f.calls.indexOf("revoke") < f.calls.indexOf("release:canceled"));
      await f.peerClosed();
    });
  }

  it("observes preparation without attaching until the allocator supplies a ready endpoint", async () => {
    const f = fixture();
    const endpoint = f.returned.endpoint!;
    f.returned.phase = "preparing";
    delete f.returned.endpoint;
    const session = f.start();
    await tick();
    assertThrows(() => session.accept({ kind: "execution" }), Error);
    assertEquals(f.calls, ["allocate"]);
    f.time.advanceBy(100);
    await tick();
    assertEquals(f.calls, ["allocate", "observe"]);
    f.returned.phase = "ready";
    f.returned.endpoint = endpoint;
    f.time.advanceBy(100);
    await session.ready;
    assertEquals(f.calls.filter((call) => call === "allocate").length, 1);
    assertEquals(f.calls.filter((call) => call === "connect").length, 1);
    await session.close();
    await f.peerClosed();
  });

  it("does not allocate for already canceled preparation and rejects already canceled acceptance", async () => {
    const preparation = new AbortController();
    preparation.abort(new Error("Synthetic private cancellation detail"));
    const f = fixture({ preparationSignal: preparation.signal });
    const session = f.start();
    await assertRejects(() => session.ready, Error, "Executor session canceled");
    assertEquals(await session.closed, { reason: "canceled", release: "not-allocated" });
    assertEquals(f.calls, []);

    const active = fixture();
    const prepared = active.start();
    await prepared.ready;
    assertThrows(
      () => prepared.accept({ kind: "execution", signal: preparation.signal }),
      Error,
      "canceled",
    );
    await prepared.closed;
    await active.peerClosed();
  });

  it("bounds an unresponsive allocator call and clears its retained allocation key", async () => {
    const deferred = Promise.withResolvers<unknown>();
    const f = fixture();
    let retainedKey: Uint8Array | undefined;
    let operationSignal: AbortSignal | undefined;
    f.allocator.allocate = (_, bootstrap, signal) => {
      retainedKey = bootstrap.channelKey;
      operationSignal = signal;
      return deferred.promise;
    };
    const session = f.start();
    const rejected = assertRejects(() => session.ready, Error, "allocation-failed");
    f.time.advanceBy(300);
    await rejected;
    assertEquals(operationSignal?.aborted, true);
    assertEquals(retainedKey, new Uint8Array(32));
    f.time.advanceBy(500);
    assertEquals((await session.closed).release, "reaper-required");
    deferred.resolve(structuredClone(f.returned));
    await tick();
    assertEquals(f.calls.includes("connect"), false);
    assertEquals(f.calls.some((call) => call.startsWith("release:")), false);
  });

  it("bounds failed release independently from the aborted session signal", async () => {
    const deferred = Promise.withResolvers<unknown>();
    const f = fixture();
    let releaseSignal: AbortSignal | undefined;
    f.allocator.release = (_binding, _reason, signal) => {
      releaseSignal = signal;
      assertEquals(signal.aborted, false);
      return deferred.promise;
    };
    const session = f.start();
    await session.ready;
    const closed = session.close();
    assertEquals(session.signal.aborted, true);
    assertEquals(releaseSignal?.aborted, false);
    f.time.advanceBy(500);
    assertEquals((await closed).release, "reaper-required");
    assertEquals(releaseSignal?.aborted, true);
    deferred.resolve({
      binding: fullBinding,
      phase: "released",
      expiresAt: 2000,
      reason: "canceled",
    });
    await tick();
    await f.peerClosed();
  });

  it("lets lease expiry revoke a channel while observation remains pending", async () => {
    const observation = Promise.withResolvers<unknown>();
    const f = fixture();
    let observeSignal: AbortSignal | undefined;
    f.allocator.observe = (_, signal) => {
      observeSignal = signal;
      return observation.promise;
    };
    const session = f.start();
    const channel = await session.ready;
    session.accept({ kind: "execution" });
    f.time.advanceBy(100);
    await tick();
    f.time.advanceBy(900);
    await tick();
    assertEquals(channel.signal.aborted, true);
    assertEquals(observeSignal?.aborted, true);
    f.time.advanceBy(500);
    assertEquals((await session.closed).reason, "expired");
    observation.resolve(structuredClone(f.returned));
    await tick();
    assertEquals(f.calls.filter((call) => call === "connect").length, 1);
    await f.peerClosed();
  });

  it("does not repeat a failed authenticated attachment or expose its error details", async () => {
    const f = fixture();
    let attempts = 0;
    f.options.connectTransport = () => {
      attempts++;
      throw new Error("Synthetic private transport detail");
    };
    const session = f.start();
    await assertRejects(() => session.ready, Error, "Executor session attachment-failed");
    assertEquals((await session.closed).release, "released");
    f.time.advanceBy(1000);
    await tick();
    assertEquals(attempts, 1);
    assertEquals(f.calls.includes("operations"), false);
    assertEquals(f.allocatedKey, new Uint8Array(32));
    assertEquals(f.time.pendingWaitCount, 0);
  });

  it("bounds a stalled attachment and closes the late transport without loading operations", async () => {
    const f = fixture();
    const connect = f.options.connectTransport;
    const delivery = Promise.withResolvers<ExecutorNodeTransport>();
    let transport: ExecutorNodeTransport | undefined;
    f.options.connectTransport = async (input) => {
      transport = await connect(input);
      return delivery.promise;
    };
    const session = f.start();
    const rejected = assertRejects(() => session.ready);
    await tick();
    f.time.advanceBy(300);
    await tick();
    try {
      assertEquals(session.signal.aborted, true);
      assertEquals(f.allocatedKey, new Uint8Array(32));
      assertEquals(f.calls.includes("operations"), false);
    } finally {
      const closing = session.close();
      delivery.resolve(transport!);
      await closing;
      await rejected;
      await f.peerClosed();
    }
    assertEquals(f.calls.filter((call) => call === "transport-close").length, 1);
  });

  it("retains process admission until raw work settles after bounded close notification", async () => {
    const allocation = Promise.withResolvers<unknown>();
    const f = fixture();
    f.allocator.allocate = () => allocation.promise;
    const session = f.start();
    const rejected = assertRejects(() => session.ready);
    const closed = session.close();
    f.time.advanceBy(500);
    assertEquals((await closed).release, "reaper-required");
    await rejected;
    try {
      let settled = false;
      void session.settled.then(() => {
        settled = true;
      });
      await tick();
      assertEquals(settled, false);
      allocation.resolve(structuredClone(f.returned));
      await session.settled;
      assertEquals(settled, true);
      assertEquals(f.calls.includes("connect"), false);
      assertEquals(f.calls.some((call) => call.startsWith("release:")), false);
    } finally {
      allocation.resolve(structuredClone(f.returned));
    }
  });

  it("retains session admission through noncooperative incoming operation cleanup", async () => {
    const finish = Promise.withResolvers<null>();
    const started = Promise.withResolvers<void>();
    const f = fixture();
    f.options.createOperations = () => ({
      operations: new Map([["wait", {
        mode: "unary",
        handle: () => {
          started.resolve();
          return finish.promise;
        },
      }]]),
      revoke() {
        f.calls.push("revoke");
      },
    });
    const session = f.start();
    await session.ready;
    const rejected = assertRejects(() => f.peer!.request("wait", null));
    await started.promise;
    const closed = session.close();
    await rejected;
    f.time.advanceBy(500);
    assertEquals((await closed).release, "released");
    let settled = false;
    void session.settled.then(() => {
      settled = true;
    });
    await tick();
    try {
      assertEquals(settled, false);
      await assertRejects(() => f.peer!.request("wait", null), Error, "closed");
      finish.resolve(null);
      await session.settled;
      assertEquals(settled, true);
      assert(f.calls.indexOf("revoke") < f.calls.indexOf("release:canceled"));
    } finally {
      finish.resolve(null);
      await f.peerClosed();
    }
  });

  it("registers allocation ownership before a client synchronously cancels preparation", async () => {
    const preparation = new AbortController();
    const allocation = Promise.withResolvers<unknown>();
    const f = fixture({ preparationSignal: preparation.signal });
    f.allocator.allocate = () => {
      preparation.abort();
      return allocation.promise;
    };
    const session = f.start();
    assertEquals(preparation.signal.aborted, true);
    await assertRejects(() => session.ready);
    let closed = false;
    let settled = false;
    void session.closed.then(() => {
      closed = true;
    });
    void session.settled.then(() => {
      settled = true;
    });
    await tick();
    try {
      assertEquals(closed, false);
      assertEquals(settled, false);
      allocation.resolve(structuredClone(f.returned));
      assertEquals((await session.closed).release, "released");
      await session.settled;
      assertEquals(f.calls.filter((call) => call === "release:canceled").length, 1);
      assertEquals(f.calls.includes("connect"), false);
    } finally {
      allocation.resolve(structuredClone(f.returned));
    }
  });

  for (const failure of ["throw", "reject"] as const) {
    it(`retires allocation work after a client ${failure} without disclosing its error`, async () => {
      const f = fixture();
      f.allocator.allocate = () => {
        const error = new Error("Synthetic private allocator detail");
        if (failure === "throw") throw error;
        return Promise.reject(error);
      };
      const session = f.start();
      await assertRejects(() => session.ready, Error, "Executor session allocation-failed");
      assertEquals(await session.closed, {
        reason: "allocation-failed",
        release: "reaper-required",
      });
      await session.settled;
      assertEquals(f.calls.includes("connect"), false);
      assertEquals(f.time.pendingWaitCount, 0);
    });

    it(`retires release work after a client ${failure} without confirming deletion`, async () => {
      const f = fixture();
      f.allocator.release = () => {
        const error = new Error("Synthetic private release detail");
        if (failure === "throw") throw error;
        return Promise.reject(error);
      };
      const session = f.start();
      await session.ready;
      assertEquals(await session.close(), { reason: "canceled", release: "reaper-required" });
      await session.settled;
      await f.peerClosed();
      assertEquals(f.time.pendingWaitCount, 0);
    });
  }

  it("retires a release whose acknowledgement validation fails without confirming deletion", async () => {
    const f = fixture();
    f.allocator.release = () =>
      Promise.resolve({
        binding: { ...fullBinding, generation: fullBinding.generation + 1 },
        phase: "released",
        expiresAt: 2000,
        reason: "canceled",
      });
    const session = f.start();
    await session.ready;
    assertEquals(await session.close(), { reason: "canceled", release: "reaper-required" });
    await session.settled;
    await f.peerClosed();
    assertEquals(f.time.pendingWaitCount, 0);
  });
});
