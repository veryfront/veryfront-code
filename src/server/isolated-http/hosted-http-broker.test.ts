import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { ProjectTraceProviderOptions } from "#veryfront/extensions/observability/tracing-exporter.ts";
import { createWorkerTraceRecorder } from "#veryfront/observability/tracing/worker-trace-recorder.ts";
import { getProjectTraceProvider } from "#veryfront/observability/tracing/project-trace-scope.ts";
import { trace } from "veryfront/observability";
import {
  flushProjectHttpTracing,
  runProjectHttpTracing,
  shutdownProjectHttpTracing,
} from "#veryfront/observability/tracing/project-http-tracing.ts";
import type { ProjectTraceConfigResult } from "#veryfront/server/project-env/telemetry-config.ts";

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorRuntimeInstallation } from "#veryfront/agent/hosted/executor-runtime-install.ts";
import type { HostedExecutorAllocation } from "#veryfront/agent/hosted/executor-session-schema.ts";
import {
  createHostedExecutorSession,
  type HostedExecutorSessionOptions,
} from "#veryfront/agent/hosted/executor-session.ts";
import { createExecutorHttpOperation } from "./executor-http.ts";
import { readExecutorHttpApplicationConfiguration } from "./application-configuration.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { createHostedHttpBroker, type HostedHttpInput } from "veryfront/server/http-broker";

function fixture(
  handle: (request: Request) => Promise<Response> | Response,
  onInstall?: (peer: ExecutorChannel, installation: ExecutorHttpInstall) => Promise<void>,
  projectId = "project-a",
) {
  const now = Date.now();
  const owner = { scopeKind: "project" as const, projectId };
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
        executionProfile: "http",
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
        async install(installed) {
          calls.push("install");
          await onInstall?.(peer!, installed);
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
  it("refuses an explicitly incompatible profile before allocation", async () => {
    const f = fixture(() => new Response("must not run"));
    f.input.session.request.executionProfile = "project-tools";
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await assertRejects(
        () => broker.fetch(new Request("https://app.example/api"), f.input),
        TypeError,
        "HTTP allocation profile",
      );
      assertEquals(f.calls.includes("allocate"), false);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("requests the HTTP allocation profile before installing application code", async () => {
    const f = fixture(() => new Response("app"));
    const allocate = f.input.session.allocator.allocate;
    f.input.session.allocator.allocate = (request, key, signal) => {
      assertEquals(Reflect.get(request, "executionProfile"), "http");
      return allocate(request, key, signal);
    };
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const response = await broker.fetch(new Request("https://app.example/api"), f.input);
      assertEquals(await response.text(), "app");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("delivers only the matched application snapshot through the allocation channel", async () => {
    let appValue: string | undefined;
    const setup = fixture(() => new Response(appValue), async (peer, installed) => {
      const configuration = await readExecutorHttpApplicationConfiguration(
        peer,
        installed,
        new AbortController().signal,
        10_000,
      );
      appValue = configuration.variables.APP_VALUE;
    });
    setup.input.configuration = {
      projectId: "project-a",
      projectSlug: "project-a",
      releaseId: "release-a",
      environmentId: "environment-a",
      environmentName: "staging",
      configurationId: "config-a",
      variables: { APP_VALUE: "matched" },
    };
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const response = await broker.fetch(
        new Request("https://app.example/api/value"),
        setup.input,
      );
      assertEquals(await response.text(), "matched");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses foreign application configuration and collector credentials before allocation", async () => {
    const setup = fixture(() => new Response("must not run"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      for (
        const [environmentId, variables] of [
          ["other-environment", {}],
          ["environment-a", { OTEL_EXPORTER_OTLP_HEADERS: "synthetic-private-value" }],
        ] as const
      ) {
        await assertRejects(() =>
          broker.fetch(new Request("https://app.example/api/value"), {
            ...setup.input,
            configuration: {
              projectId: "project-a",
              projectSlug: "project-a",
              releaseId: "release-a",
              environmentId,
              environmentName: "staging",
              configurationId: "config-a",
              variables,
            },
          })
        );
      }
      assertEquals(setup.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

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

// Managed settings must be bound before any allocator or exporter work.
describe("hosted HTTP project tracing", () => {
  for (const foreign of ["project", "environment"] as const) {
    it(`refuses another ${foreign} collector settings before allocating`, async () => {
      const f = fixture(() => new Response("must not run"));
      const broker = createHostedHttpBroker({ maxActive: 1 });
      try {
        await assertRejects(
          () =>
            broker.fetch(new Request("https://app.example/api"), {
              ...f.input,
              projectTracing: {
                status: "enabled",
                config: {
                  projectId: foreign === "project" ? "project-b" : "project-a",
                  environmentId: foreign === "environment" ? "environment-b" : "environment-a",
                  revision: "one",
                  endpoint: "https://collector.example/v1/traces",
                  headers: {},
                  serviceName: "app",
                  serviceVersion: "",
                  deploymentEnvironment: "production",
                },
              },
            }),
          TypeError,
          "tracing identity",
        );
        assertEquals(f.calls, []);
      } finally {
        await broker.shutdown();
        await broker.settled;
      }
    });
  }
});

for (const rejectsImport of [false, true]) {
  it(`retains streamed responses and project span ownership (import rejects: ${rejectsImport})`, async () => {
    const received: Array<{ project: string; records: string; parent: string }> = [];
    register("TracingExporter", {
      createProjectProvider(options: ProjectTraceProviderOptions) {
        const recorder = createWorkerTraceRecorder(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`)!;
        const provider = recorder.run(() => getProjectTraceProvider())!;
        provider.importSpans = (records, parent) => {
          received.push({
            project: options.resource["project.id"]!,
            records,
            parent: parent.spanId,
          });
          if (rejectsImport) throw new Error("Synthetic exporter failure");
        };
        return Promise.resolve(provider);
      },
    });
    const settings: ProjectTraceConfigResult = {
      status: "enabled",
      config: {
        projectId: "project-a",
        environmentId: "environment-a",
        revision: "one",
        endpoint: "https://collector.example/v1/traces",
        headers: { Authorization: "Bearer test-only" },
        serviceName: "app",
        serviceVersion: "",
        deploymentEnvironment: "production",
      },
    };
    const f = fixture((request) => {
      assertEquals(request.headers.get("authorization"), "Bearer application");
      assertEquals(request.headers.get("x-token"), null);
      return new Response(
        new ReadableStream({
          pull(controller) {
            trace.getTracer("application").startSpan("deferred.executor.span").end();
            controller.enqueue(new TextEncoder().encode("streamed"));
            controller.close();
          },
        }, { highWaterMark: 0 }),
      );
    });
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      await runProjectHttpTracing(
        settings,
        settings.config,
        new Request("https://app.example"),
        () => Promise.resolve(new Response(null, { status: 204 })),
      );
      await flushProjectHttpTracing();
      const response = await broker.fetch(
        new Request("https://app.example/api", {
          headers: { authorization: "Bearer application", "x-token": "host-only" },
        }),
        { ...f.input, projectTracing: settings },
      );
      assertEquals(received.length, 0);
      const secondSettings = {
        ...settings,
        config: { ...settings.config, projectId: "project-b" },
      };
      await runProjectHttpTracing(
        secondSettings,
        secondSettings.config,
        new Request("https://b.example"),
        () => Promise.resolve(new Response(null, { status: 204 })),
      );
      await flushProjectHttpTracing();
      const second = fixture(
        () => {
          trace.getTracer("application").startSpan("second.project.span").end();
          return new Response("second");
        },
        undefined,
        "project-b",
      );
      const otherResponse = await broker.fetch(new Request("https://b.example"), {
        ...second.input,
        projectTracing: secondSettings,
      });
      assertEquals(await otherResponse.text(), "second");
      assertEquals(received.length, 1);
      assertEquals(received[0]!.project, "project-b");
      assertEquals(received[0]!.records.includes("second.project.span"), true);
      received.length = 0;
      assertEquals(await response.text(), "streamed");
      assertEquals(received.length, 1);
      assertEquals(received[0]!.project, "project-a");
      const records = JSON.parse(received[0]!.records);
      assertExists(
        records.find((record: { name: string; parentSpanId: string }) =>
          record.name === "deferred.executor.span" && record.parentSpanId === received[0]!.parent
        ),
      );
    } finally {
      await broker.shutdown();
      await broker.settled;
      await shutdownProjectHttpTracing();
      unregister("TracingExporter");
    }
  });
}

for (const status of ["disabled", "deferred", "invalid"] as const) {
  it(`does not inherit outer project tracing when managed tracing is ${status}`, async () => {
    const outer = createWorkerTraceRecorder(`00-${"c".repeat(32)}-${"d".repeat(16)}-01`)!;
    const f = fixture(() => {
      assertEquals(getProjectTraceProvider(), undefined);
      return new Response("untraced");
    });
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const response = await outer.run(() =>
        broker.fetch(
          new Request("https://app.example", {
            headers: { traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-01` },
          }),
          {
            ...f.input,
            projectTracing: status === "invalid" ? { status, reason: "endpoint" } : { status },
          },
        )
      );
      assertEquals(await response.text(), "untraced");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });
}

it("refuses competing managed and explicit tracing before allocation", async () => {
  const f = fixture(() => new Response("must not run"));
  const broker = createHostedHttpBroker({ maxActive: 1 });
  try {
    await assertRejects(
      () =>
        broker.fetch(new Request("https://app.example"), {
          ...f.input,
          projectTracing: { status: "disabled" },
          tracing: { traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`, onRecords() {} },
        }),
      TypeError,
      "cannot be combined",
    );
    assertEquals(f.calls, []);
  } finally {
    await broker.shutdown();
    await broker.settled;
  }
});

it("errors an unfinished managed-tracing response when its request aborts", async () => {
  register("TracingExporter", {
    createProjectProvider() {
      const recorder = createWorkerTraceRecorder(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`)!;
      return Promise.resolve(recorder.run(() => getProjectTraceProvider())!);
    },
  });
  const settings: ProjectTraceConfigResult = {
    status: "enabled",
    config: {
      projectId: "project-a",
      environmentId: "environment-a",
      revision: "abort",
      endpoint: "https://collector.example/v1/traces",
      headers: {},
      serviceName: "app",
      serviceVersion: "",
      deploymentEnvironment: "production",
    },
  };
  const f = fixture(() =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("prefix"));
        },
      }, { highWaterMark: 0 }),
    )
  );
  const broker = createHostedHttpBroker({ maxActive: 1 });
  const abort = new AbortController();
  try {
    await runProjectHttpTracing(
      settings,
      settings.config,
      new Request("https://app.example"),
      () => Promise.resolve(new Response(null, { status: 204 })),
    );
    await flushProjectHttpTracing();
    const response = await broker.fetch(
      new Request("https://app.example", { signal: abort.signal }),
      {
        ...f.input,
        projectTracing: settings,
      },
    );
    const reader = response.body!.getReader();
    assertEquals(new TextDecoder().decode((await reader.read()).value), "prefix");
    const pending = reader.read();
    abort.abort(new Error("Client disconnected"));
    await assertRejects(() => pending, Error, "Client disconnected");
    assertEquals(f.calls.includes("release:completed"), false);
  } finally {
    abort.abort();
    await broker.shutdown();
    await broker.settled;
    await shutdownProjectHttpTracing();
    unregister("TracingExporter");
  }
});
