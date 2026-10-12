import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTrackedRequests, waitForPromiseWithTimeout } from "../../../_helpers/server.ts";

describe("dev response cleanup", () => {
  it("keeps the deadline and cancels a response whose headers arrive late", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async () => {
        started.resolve();
        await release.promise;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("late page"));
            },
            cancel() {
              cancelled.resolve();
            },
          }),
        );
      },
    );
    const requests = createTrackedRequests();
    try {
      await assertRejects(
        () => requests.fetch(`http://127.0.0.1:${server.addr.port}/`, 1),
        DOMException,
        "The request timed out",
      );
      await started.promise;
      release.resolve();
      await requests.settle();
      await cancelled.promise;
    } finally {
      release.resolve();
      await server.shutdown();
      await requests.settle();
    }
  });

  it("closes a late transport even when body cancellation waits for that transport", async () => {
    const headers = Promise.withResolvers<Response>();
    const transportClosed = Promise.withResolvers<void>();
    let aborted = false;
    const requests = createTrackedRequests((_url, init) => {
      if (init && "signal" in init && init.signal instanceof AbortSignal) {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          transportClosed.resolve();
        }, { once: true });
      }
      return headers.promise;
    });
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => transportClosed.promise,
      }),
    );
    try {
      await assertRejects(
        () => requests.fetch("http://late-response.test/", 1),
        DOMException,
        "The request timed out",
      );
      assert(!aborted, "Do not abort before ownership of the late response is established");
      headers.resolve(response);
      await waitForPromiseWithTimeout(
        transportClosed.promise,
        1_000,
        "Late transport remained open during body cancellation",
      );
      await requests.settle();
    } finally {
      headers.resolve(response);
      transportClosed.resolve();
      await requests.settle();
    }
  });

  it("closes the late transport and reports a body-cancellation failure", async () => {
    const headers = Promise.withResolvers<Response>();
    const transportClosed = Promise.withResolvers<void>();
    const failure = new Error("body cancellation failed");
    const requests = createTrackedRequests((_url, init) => {
      if (init && "signal" in init && init.signal instanceof AbortSignal) {
        init.signal.addEventListener("abort", () => transportClosed.resolve(), { once: true });
      }
      return headers.promise;
    });
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          throw failure;
        },
      }),
    );
    try {
      await assertRejects(
        () => requests.fetch("http://late-response.test/", 1),
        DOMException,
        "The request timed out",
      );
      headers.resolve(response);
      await waitForPromiseWithTimeout(
        transportClosed.promise,
        1_000,
        "Failed cleanup left the transport open",
      );
      const error = await assertRejects(
        () => requests.settle(),
        AggregateError,
        "Failed to cancel late response bodies",
      );
      assert(error instanceof AggregateError);
      assertEquals(error.errors, [failure]);
    } finally {
      headers.resolve(response);
      transportClosed.resolve();
      await requests.settle().catch((error) => {
        assert(error instanceof AggregateError);
        assertEquals(error.errors, [failure]);
      });
    }
  });

  it("releases responses when timeouts race with response headers", async () => {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () => new Response("quiet dev logs page"),
    );
    const requests = createTrackedRequests();
    const url = `http://127.0.0.1:${server.addr.port}/`;
    try {
      for (let attempt = 0; attempt < 1_000; attempt++) {
        let response: Response;
        try {
          response = await requests.fetch(url, 1);
        } catch (error) {
          assert(error instanceof DOMException && error.name === "AbortError");
          continue;
        }
        await response.body?.cancel();
      }
    } finally {
      await server.shutdown();
      await requests.settle();
    }
  });

  it("releases a real response body aborted after the first chunk", async () => {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial page"));
            },
          }),
        ),
    );
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${server.addr.port}/`, {
        signal: controller.signal,
      });
      const body = response.body;
      assert(body !== null);
      const reader = body.getReader();
      try {
        assert(!(await reader.read()).done);
        const pendingRead = reader.read();
        controller.abort();
        await assertRejects(() => pendingRead, DOMException);
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      assert(!body.locked);
    } finally {
      controller.abort();
      await server.shutdown();
    }
  });
});
