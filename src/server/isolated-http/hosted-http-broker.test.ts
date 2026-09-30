import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorRuntimeInstallation } from "#veryfront/agent/hosted/executor-runtime-install.ts";
import type { HostedExecutorAllocation } from "#veryfront/agent/hosted/executor-session-schema.ts";
import {
  createHostedExecutorSession,
  type HostedExecutorSessionOptions,
} from "#veryfront/agent/hosted/executor-session.ts";
import { createExecutorHttpOperation } from "./executor-http.ts";
import { createHostedHttpBroker, type HostedHttpInput } from "veryfront/server/http-broker";

function fixture(handle: (request: Request) => Promise<Response> | Response) {
  const now = Date.now();
  const owner = { scopeKind: "project" as const, projectId: "project-a" };
  const source = { type: "release" as const, releaseId: "release-a" };
  const image = `registry.example/executor@sha256:${"a".repeat(64)}`;
  const request = {
    allocationId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
    owner,
    source,
    requestedAt: now,
    prepareDeadlineAt: now + 5000,
    hardDeadlineAt: now + 30_000,
  };
  const binding = { ...request, generation: 1, brokerInstanceId: "broker-a" };
  const calls: string[] = [];
  const releaseEntered = Promise.withResolvers<void>();
  const releaseAllowed = Promise.withResolvers<void>();
  let holdRelease = false;
  let peer: ExecutorChannel | undefined;
  function view(
    phase: "ready" | "released",
    reason?: "completed" | "canceled",
  ): HostedExecutorAllocation {
    return {
      binding: {
        allocationId: binding.allocationId,
        invocationId: binding.invocationId,
        generation: 1,
        brokerInstanceId: binding.brokerInstanceId,
        owner,
        source,
      },
      phase,
      expiresAt: now + 30_000,
      ...(phase === "ready"
        ? {
          endpoint: {
            address: "127.0.0.1",
            port: 8081 as const,
            podUid: "pod-a",
            nodeName: "node-a",
            image,
            channelAuthenticated: false as const,
          },
        }
        : { reason }),
    };
  }
  const session: Omit<HostedExecutorSessionOptions, "createOperations" | "preparationSignal"> = {
    request,
    expectedImage: image,
    expectedBrokerInstanceId: "broker-a",
    allocator: {
      allocate: () => {
        calls.push("allocate");
        return Promise.resolve(view("ready"));
      },
      observe: () => Promise.resolve(view("ready")),
      renew: () => Promise.resolve(view("ready")),
      async release(_binding, reason) {
        calls.push(`release:${reason}`);
        releaseEntered.resolve();
        if (holdRelease) await releaseAllowed.promise;
        return view("released", reason);
      },
    },
    connectTransport(input) {
      const forward = new TransformStream<Uint8Array>();
      const backward = new TransformStream<Uint8Array>();
      const retired = Promise.withResolvers<void>();
      const installation = createExecutorRuntimeInstallation({
        mode: "http",
        binding: input.binding,
        artifact: { version: 1, owner, source, root: "project" },
        async install() {
          calls.push("install");
          return {
            operations: new Map([[
              "http.request",
              createExecutorHttpOperation({ binding: input.binding, channel: () => peer!, handle }),
            ]]),
            close: () => {
              retired.resolve();
              return Promise.resolve();
            },
            settled: retired.promise,
          };
        },
      });
      peer = createExecutorChannel({
        binding: input.binding,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: installation.operations,
      });
      void peer.closed.then(() => installation.close());
      return Promise.resolve({
        readable: backward.readable,
        writable: forward.writable,
        close: () => peer?.close(),
      });
    },
  };
  const input: HostedHttpInput = {
    session,
    installation: {
      version: 1,
      mode: "http",
      owner,
      source,
      root: "project",
      environmentId: "environment-a",
      configurationId: "config-a",
    },
  };
  return {
    input,
    calls,
    releaseEntered,
    releaseAllowed,
    holdRelease() {
      holdRelease = true;
    },
  };
}

describe("hosted HTTP executor broker", () => {
  it("rejects an unfinished response when executor shutdown interrupts it", async () => {
    const f = fixture(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          },
        }),
      )
    );
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const response = await broker.fetch(new Request("https://app.example/api/download"), f.input);
      const outcome = response.text().then(() => "completed", () => "failed");
      await broker.shutdown();
      assertEquals(await outcome, "failed");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("releases a failed response body as canceled", async () => {
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const f = fixture(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
          },
        }),
      )
    );
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const response = await broker.fetch(new Request("https://app.example/api/stream"), f.input);
      source!.error(new Error("Synthetic response failure"));
      await assertRejects(() => response.text());
      await f.releaseEntered.promise;
      assertEquals(f.calls.includes("release:canceled"), true);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("releases an abandoned response as canceled without requiring request abort", async () => {
    const f = fixture(() => new Response(new ReadableStream<Uint8Array>({})));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const request = new Request("https://app.example/api/stream");
      const response = await broker.fetch(request, f.input);
      await response.body!.cancel();
      await f.releaseEntered.promise;
      assertEquals(request.signal.aborted, false);
      assertEquals(f.calls.includes("release:canceled"), true);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("returns an execution error while allocation cleanup is still pending", async () => {
    const f = fixture(() => {
      throw new Error("synthetic application failure");
    });
    f.holdRelease();
    const broker = createHostedHttpBroker({ maxActive: 1 });
    let rejected = false;
    const pending = broker.fetch(new Request("https://app.example/api/fail"), f.input);
    const failed = assertRejects(() => pending, Error, "operation-failed").then(() => {
      rejected = true;
    });
    try {
      await f.releaseEntered.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(rejected, true);
      assertEquals(broker.active, 1);
    } finally {
      f.releaseAllowed.resolve();
      await failed;
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("preserves the execution error when a trusted session close rejects", async () => {
    const f = fixture(() => {
      throw new Error("synthetic application failure");
    });
    let restore = () => {};
    const broker = createHostedHttpBroker({
      maxActive: 1,
      createSession(options) {
        const session = createHostedExecutorSession(options);
        const close = session.close.bind(session);
        session.close = () => Promise.reject(new Error("synthetic cleanup failure"));
        restore = () => {
          session.close = close;
        };
        return session;
      },
    });
    try {
      await assertRejects(
        () => broker.fetch(new Request("https://app.example/api/fail"), f.input),
        Error,
        "operation-failed",
      );
    } finally {
      restore();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("streams a request through the admitted installation and releases on completion", async () => {
    const f = fixture((request) => {
      assertEquals(request.headers.get("x-token"), null);
      return new Response(request.body, { status: 201 });
    });
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
      const response = await broker.fetch(
        new Request("https://app.example/api/echo", {
          method: "POST",
          body: bytes,
          headers: { "x-token": "synthetic-platform-secret" },
        }),
        f.input,
      );
      assertEquals(response.status, 201);
      assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
      await f.releaseEntered.promise;
      assertEquals(f.calls, ["allocate", "install", "release:completed"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("rejects mismatched project or release authority before allocation", async () => {
    const f = fixture(() => new Response("unused"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      for (
        const installation of [
          {
            ...f.input.installation,
            owner: { scopeKind: "project" as const, projectId: "project-b" },
          },
          { ...f.input.installation, source: { type: "release" as const, releaseId: "release-b" } },
        ]
      ) {
        await assertRejects(() =>
          broker.fetch(new Request("https://app.example/api/data"), { ...f.input, installation })
        );
      }
      assertEquals(f.calls, []);
    } finally {
      await broker.shutdown();
    }
  });

  it("retains pool admission through body consumption and allocation retirement", async () => {
    const f = fixture(() => new Response("complete"));
    f.holdRelease();
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const response = await broker.fetch(new Request("https://app.example/api/data"), f.input);
      assertEquals(broker.active, 1);
      assertEquals(f.calls, ["allocate", "install"]);
      assertEquals(await response.text(), "complete");
      await f.releaseEntered.promise;
      assertEquals(broker.active, 1);
      await assertRejects(
        () => broker.fetch(new Request("https://app.example/api/data"), f.input),
        Error,
        "capacity",
      );
      f.releaseAllowed.resolve();
      await broker.shutdown();
      await broker.settled;
      assertEquals(broker.active, 0);
    } finally {
      f.releaseAllowed.resolve();
      await broker.shutdown();
    }
  });

  it("cancels a pending application response and retires its allocation", async () => {
    const entered = Promise.withResolvers<void>();
    const f = fixture(async (request) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), { once: true })
      );
      request.signal.throwIfAborted();
      return new Response("unreachable");
    });
    const broker = createHostedHttpBroker({ maxActive: 1 });
    const controller = new AbortController();
    try {
      const pending = broker.fetch(
        new Request("https://app.example/api/wait", { signal: controller.signal }),
        f.input,
      );
      const rejected = assertRejects(() => pending);
      await entered.promise;
      controller.abort();
      await rejected;
      await f.releaseEntered.promise;
      assertEquals(f.calls.includes("release:canceled"), true);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("rejects an allocated image that differs from the trusted digest", async () => {
    const f = fixture(() => new Response("must not execute"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await assertRejects(() =>
        broker.fetch(new Request("https://app.example/api/data"), {
          ...f.input,
          session: {
            ...f.input.session,
            expectedImage: `registry.example/executor@sha256:${"b".repeat(64)}`,
          },
        })
      );
      assertEquals(f.calls.includes("install"), false);
      assertEquals(f.calls.includes("release:canceled"), true);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });
});
