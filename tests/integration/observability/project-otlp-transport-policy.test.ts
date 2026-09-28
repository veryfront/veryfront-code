import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";
import {
  createProjectOtlpTransport,
  PROJECT_OTLP_MAX_REQUEST_BYTES,
} from "#veryfront/observability/tracing/project-otlp-transport.ts";

const endpoint = "https://collector.example/v1/traces";
const bytes = new TextEncoder().encode('{"resourceSpans":[]}');
const suppression = new AsyncLocalStorage<boolean>();
const withSuppressedTracing = <T>(operation: () => Promise<T>) => suppression.run(true, operation);

describe("project OTLP transport", () => {
  it("launches one request despite replaced Promise construction and chaining", async () => {
    const response = Promise.resolve(Response.json({}));
    const addresses = Promise.resolve(["93.184.216.34"]);
    let sends = 0;
    await __runWithOutboundFetchTransportForTests({
      resolveHost: () => addresses,
      fetch: () => {
        throw new Error("Expected the pinned transport");
      },
      pinnedFetch: () => {
        sends++;
        return response;
      },
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const NativePromise = Promise;
      const descriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
      const nativeThen = Promise.prototype.then;
      let constructions = 0;
      let status: string | undefined;
      try {
        globalThis.Promise = new Proxy(NativePromise, {
          construct(target, args, newTarget) {
            constructions++;
            return Reflect.construct(target, args, newTarget);
          },
        });
        Object.defineProperty(NativePromise.prototype, "then", {
          ...descriptor,
          value: function (
            this: Promise<unknown>,
            fulfilled?: (value: unknown) => unknown,
            rejected?: (reason: unknown) => unknown,
          ) {
            return Reflect.apply(nativeThen, this, [
              fulfilled
                ? (value: unknown) => {
                  fulfilled(value);
                  return fulfilled(value);
                }
                : fulfilled,
              rejected,
            ]);
          },
        });
        status = (await transport.send(bytes, 1000)).status;
      } finally {
        globalThis.Promise = NativePromise;
        Object.defineProperty(NativePromise.prototype, "then", descriptor);
      }
      try {
        assertEquals(status, "success");
        assertEquals(sends, 1);
        assertEquals(constructions, 0);
      } finally {
        transport.shutdown();
      }
    });
  });

  it("discards collector responses without invoking replaced response and stream hooks", async () => {
    let cancelled = 0;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    );
    const release = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    await withMockFetch(() => {
      started.resolve();
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const pending = transport.send(bytes, 1000);
      await started.promise;
      const body = Object.getOwnPropertyDescriptor(Response.prototype, "body")!;
      const ok = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!;
      const cancel = ReadableStream.prototype.cancel;
      let observed = 0;
      try {
        Object.defineProperty(Response.prototype, "body", {
          ...body,
          get() {
            observed++;
            return Reflect.apply(body.get!, this, []);
          },
        });
        Object.defineProperty(Response.prototype, "ok", {
          ...ok,
          get() {
            observed++;
            return false;
          },
        });
        ReadableStream.prototype.cancel = () => {
          observed++;
          return Promise.resolve();
        };
        release.resolve(response);
        assertEquals((await pending).status, "success");
      } finally {
        Object.defineProperty(Response.prototype, "body", body);
        Object.defineProperty(Response.prototype, "ok", ok);
        ReadableStream.prototype.cancel = cancel;
        transport.shutdown();
      }
      assertEquals(observed, 0);
      assertEquals(cancelled, 1);
    });
  });

  it("keeps the send cap when Set tracking methods are replaced", async () => {
    const release = Promise.withResolvers<Response>();
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const size = Object.getOwnPropertyDescriptor(Set.prototype, "size")!;
      const add = Set.prototype.add;
      let pending: Promise<unknown>[] = [];
      try {
        Object.defineProperty(Set.prototype, "size", { configurable: true, get: () => 0 });
        Set.prototype.add = function () {
          return this;
        };
        pending = [
          transport.send(bytes, 1000),
          transport.send(bytes, 1000),
          transport.send(bytes, 1000),
        ];
      } finally {
        Object.defineProperty(Set.prototype, "size", size);
        Set.prototype.add = add;
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(calls, 2);
      } finally {
        transport.shutdown();
        release.resolve(Response.json({}));
        await Promise.all(pending);
      }
    });
  });

  it("aborts requests through the native method after prototype replacement", async () => {
    const release = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    let signal: AbortSignal | null | undefined;
    await withMockFetch((_input, init) => {
      signal = init?.signal;
      started.resolve();
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const pending = transport.send(bytes, 1000);
      await started.promise;
      const abort = AbortController.prototype.abort;
      const deleteEntry = Set.prototype.delete;
      const iterator = Set.prototype[Symbol.iterator];
      const forEach = Set.prototype.forEach;
      try {
        AbortController.prototype.abort = () => {};
        Set.prototype.delete = () => false;
        Set.prototype[Symbol.iterator] = () => new Set().values();
        Set.prototype.forEach = () => {};
        transport.shutdown();
      } finally {
        AbortController.prototype.abort = abort;
        Set.prototype.delete = deleteEntry;
        Set.prototype[Symbol.iterator] = iterator;
        Set.prototype.forEach = forEach;
      }
      try {
        assertEquals(signal?.aborted, true);
      } finally {
        transport.shutdown();
        release.resolve(Response.json({}));
        await pending;
      }
    });
  });

  it("checks payload size without invoking replaced byte-length getters", async () => {
    await withMockFetch(() => Promise.resolve(Response.json({})), async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const oversized = new Uint8Array(PROJECT_OTLP_MAX_REQUEST_BYTES + 1);
      const original = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "byteLength");
      let exposed = false;
      let normal: ReturnType<typeof transport.send>;
      let large: ReturnType<typeof transport.send>;
      try {
        Object.defineProperty(Uint8Array.prototype, "byteLength", {
          configurable: true,
          get() {
            if (this === bytes || this === oversized) exposed = true;
            return 0;
          },
        });
        normal = transport.send(bytes, 1000);
        large = transport.send(oversized, 1000);
      } finally {
        if (original) Object.defineProperty(Uint8Array.prototype, "byteLength", original);
        else Reflect.deleteProperty(Uint8Array.prototype, "byteLength");
      }
      try {
        assertEquals((await normal).status, "success");
        assertEquals((await large).status, "failure");
        assertEquals(exposed, false);
      } finally {
        transport.shutdown();
      }
    });
  });

  it("copies payloads without calling a tenant-replaced byte-array constructor", async () => {
    await withMockFetch(() => Promise.resolve(Response.json({})), async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const NativeUint8Array = globalThis.Uint8Array;
      let exposed = false;
      let pending: ReturnType<typeof transport.send>;
      try {
        globalThis.Uint8Array = new Proxy(NativeUint8Array, {
          construct(target, args) {
            if (args[0] === bytes) exposed = true;
            return Reflect.construct(target, args);
          },
        });
        pending = transport.send(bytes, 1000);
      } finally {
        globalThis.Uint8Array = NativeUint8Array;
      }
      try {
        assertEquals(await pending, { status: "success" });
        assertEquals(exposed, false);
      } finally {
        transport.shutdown();
      }
    });
  });

  it("owns the JSON content type even when supplied headers use different casing", async () => {
    await withMockFetch((input, init) => {
      const request = new Request(input, init);
      assertEquals(request.headers.get("content-type"), "application/json");
      return Promise.resolve(Response.json({}));
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: { "Content-Type": "text/plain" },
        withSuppressedTracing,
      });
      assertEquals((await transport.send(bytes, 1000)).status, "success");
      transport.shutdown();
    });
  });

  it("snapshots credentials and sends through the guarded transport in suppressed context", async () => {
    let request: Request | undefined;
    await withMockFetch(async (input, init) => {
      await Promise.resolve();
      assertEquals(suppression.getStore(), true);
      request = new Request(input, init);
      return Response.json({});
    }, async () => {
      const headers = { authorization: "Bearer synthetic-token" };
      const data = bytes.slice();
      const transport = createProjectOtlpTransport({ endpoint, headers, withSuppressedTracing });
      headers.authorization = "changed";
      const result = transport.send(data, 1000);
      data.fill(0);
      assertEquals(await result, { status: "success" });
      transport.shutdown();
    });
    assertExists(request);
    assertEquals(request.url, endpoint);
    assertEquals(request.method, "POST");
    assertEquals(request.headers.get("authorization"), "Bearer synthetic-token");
    assertEquals(request.headers.get("content-type"), "application/json");
    assertEquals(await request.text(), new TextDecoder().decode(bytes));
  });

  it("rejects redirects without forwarding collector credentials", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { location: "https://other.example/v1/traces" },
        }),
      );
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: { authorization: "Bearer synthetic-token" },
        withSuppressedTracing,
      });
      const result = await transport.send(bytes, 1000);
      assertEquals(result.status, "failure");
      if (result.status === "failure") {
        assertEquals(result.error.message, "Project trace export failed");
      }
      transport.shutdown();
    });
    assertEquals(calls, 1);
  });

  it("blocks private DNS answers before sending any bytes", async () => {
    let calls = 0;
    await withEnv(
      {
        VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "false",
        VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS: "",
      },
      () =>
        __runWithOutboundFetchTransportForTests({
          fetch: () => {
            calls++;
            return Promise.resolve(Response.json({}));
          },
          resolveHost: () => Promise.resolve(["169.254.169.254"]),
        }, async () => {
          const transport = createProjectOtlpTransport({
            endpoint,
            headers: {},
            withSuppressedTracing,
          });
          assertEquals((await transport.send(bytes, 1000)).status, "failure");
          transport.shutdown();
        }),
    );
    assertEquals(calls, 0);
  });

  it("does not include collector response data in export errors", async () => {
    await withMockFetch(
      () => Promise.resolve(new Response("synthetic-secret-echo", { status: 503 })),
      async () => {
        const transport = createProjectOtlpTransport({
          endpoint,
          headers: {},
          withSuppressedTracing,
        });
        const result = await transport.send(bytes, 1000);
        assertEquals(result.status, "failure");
        if (result.status === "failure") {
          assertEquals(
            result.error.message,
            "Project trace export failed",
          );
        }
        transport.shutdown();
      },
    );
  });

  it("uses pinned public DNS answers and rejects a later private answer", async () => {
    let resolves = 0;
    let sends = 0;
    await withEnv(
      { VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "false" },
      () =>
        __runWithOutboundFetchTransportForTests({
          fetch: () => {
            throw new Error("must use the pinned transport");
          },
          resolveHost: () => Promise.resolve(++resolves === 1 ? ["93.184.216.34"] : ["10.0.0.8"]),
          pinnedFetch: (_url, addresses) => {
            sends++;
            assertEquals(addresses, ["93.184.216.34"]);
            return Promise.resolve(Response.json({}));
          },
        }, async () => {
          const transport = createProjectOtlpTransport({
            endpoint,
            headers: {},
            withSuppressedTracing,
          });
          assertEquals((await transport.send(bytes, 1000)).status, "success");
          assertEquals((await transport.send(bytes, 1000)).status, "failure");
          transport.shutdown();
        }),
    );
    assertEquals(sends, 1);
  });

  it("bounds concurrent sends without preventing another destination from exporting", async () => {
    const release = Promise.withResolvers<Response>();
    let slowCalls = 0;
    await withMockFetch((input) => {
      if (String(input).includes("/slow")) {
        slowCalls++;
        return release.promise;
      }
      return Promise.resolve(Response.json({}));
    }, async () => {
      const slow = createProjectOtlpTransport({
        endpoint: `${endpoint}/slow`,
        headers: {},
        withSuppressedTracing,
      });
      const healthy = createProjectOtlpTransport({ endpoint, headers: {}, withSuppressedTracing });
      const first = slow.send(bytes, 1000);
      const second = slow.send(bytes, 1000);
      try {
        assertEquals((await slow.send(bytes, 1000)).status, "failure");
        assertEquals((await healthy.send(bytes, 1000)).status, "success");
        assertEquals(slowCalls, 2);
      } finally {
        slow.shutdown();
        healthy.shutdown();
        release.resolve(Response.json({}));
        await Promise.all([first, second]);
      }
    });
  });

  it("settles at the deadline even when the fetch implementation ignores abort", async () => {
    const release = Promise.withResolvers<Response>();
    let signal: AbortSignal | null | undefined;
    await withMockFetch((_input, init) => {
      signal = init?.signal;
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      try {
        const result = await transport.send(bytes, 10);
        assertEquals(result.status, "failure");
        assertEquals(signal?.aborted, true);
      } finally {
        release.resolve(Response.json({}));
        transport.shutdown();
      }
    });
  });

  it("shutdown settles active sends and rejects further sends", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    await withMockFetch(() => {
      started.resolve();
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const send = transport.send(bytes, 1000);
      await started.promise;
      transport.shutdown();
      assertEquals((await send).status, "failure");
      assertEquals((await transport.send(bytes, 1000)).status, "failure");
      release.resolve(Response.json({}));
    });
  });

  it("rejects oversized payloads and invalid time budgets without a request", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json({}));
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      assertEquals(
        (await transport.send(new Uint8Array(PROJECT_OTLP_MAX_REQUEST_BYTES + 1), 1000)).status,
        "failure",
      );
      for (const timeout of [0, -1, NaN, Infinity]) {
        assertEquals((await transport.send(bytes, timeout)).status, "failure");
      }
      transport.shutdown();
    });
    assertEquals(calls, 0);
  });
});
