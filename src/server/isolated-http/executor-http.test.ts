import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createExecutorChannel,
  type ExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import { createExecutorHttpClient, createExecutorHttpOperation } from "./executor-http.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { trace } from "veryfront/observability";

const binding = { allocationId: "http-allocation", generation: 1, invocationId: "http-generation" };

function connect(
  handle: (request: Request) => Promise<Response> | Response,
  remoteOperation?: ExecutorOperation,
) {
  const client = createExecutorHttpClient({ binding, channel: () => host });
  const operation = createExecutorHttpOperation({ binding, channel: () => child, handle });
  const forward = new TransformStream<Uint8Array>();
  const backward = new TransformStream<Uint8Array>();
  const host: ExecutorChannel = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
    operations: client.operations,
  });
  const child: ExecutorChannel = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations: new Map([["http.request", remoteOperation ?? operation]]),
  });
  return {
    client,
    async close() {
      await client.close();
      child.close();
      await Promise.all([host.settled, child.settled]);
    },
  };
}

describe("authenticated executor HTTP transport", () => {
  it("preserves binary upload, response status, content type and separate cookies", async () => {
    const bytes = Uint8Array.from({ length: 90_000 }, (_, i) => i % 256);
    const pair = connect(async (request) => {
      assertEquals(request.method, "PATCH");
      assertEquals(request.headers.get("content-length"), String(bytes.length));
      assertEquals(new URL(request.url).search, "?version=one");
      assertEquals(new Uint8Array(await request.arrayBuffer()), bytes);
      return new Response(bytes, {
        status: 202,
        headers: [
          ["content-type", "application/octet-stream"],
          ["content-length", String(bytes.length)],
          ["set-cookie", "a=1"],
          [
            "set-cookie",
            "b=2",
          ],
        ],
      });
    });
    try {
      const response = await pair.client.fetch(
        new Request("https://app.example/api/data?version=one", {
          method: "PATCH",
          headers: { "content-length": String(bytes.length) },
          body: bytes,
        }),
      );
      assertEquals(response.status, 202);
      assertEquals(response.headers.get("content-length"), String(bytes.length));
      assertEquals(response.headers.get("content-type"), "application/octet-stream");
      assertEquals(response.headers.getSetCookie(), ["a=1", "b=2"]);
      assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
    } finally {
      await pair.close();
    }
  });

  it("strips infrastructure and hop-by-hop headers before project execution", async () => {
    const pair = connect((request) => {
      for (const name of ["x-token", "x-project-id", "x-veryfront-secret", "connection", "x-hop"]) {
        assertEquals(request.headers.get(name), null, name);
      }
      assertEquals(request.headers.get("authorization"), "Bearer application-credential");
      return new Response("ok");
    });
    try {
      const response = await pair.client.fetch(
        new Request("https://app.example/api/data", {
          headers: {
            "x-token": "synthetic-platform-secret",
            "x-project-id": "forged",
            "x-veryfront-secret": "synthetic-platform-secret",
            connection: "x-hop",
            "x-hop": "private-hop",
            authorization: "Bearer application-credential",
          },
        }),
      );
      assertEquals(await response.text(), "ok");
    } finally {
      await pair.close();
    }
  });

  it("delivers response headers and chunks before the response finishes", async () => {
    const finish = Promise.withResolvers<void>();
    const pair = connect(() =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first"));
            await finish.promise;
            controller.enqueue(new TextEncoder().encode("last"));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    );
    try {
      const response = await pair.client.fetch(new Request("https://app.example/api/events"));
      const reader = response.body!.getReader();
      assertEquals(new TextDecoder().decode((await reader.read()).value), "first");
      finish.resolve();
      assertEquals(new TextDecoder().decode((await reader.read()).value), "last");
      assertEquals((await reader.read()).done, true);
      reader.releaseLock();
    } finally {
      finish.resolve();
      await pair.close();
    }
  });

  it("cancels an unread upload when the application responds early", async () => {
    const canceled = Promise.withResolvers<void>();
    const pair = connect(() => new Response(null, { status: 413 }));
    try {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          canceled.resolve();
        },
      });
      const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
      const response = await pair.client.fetch(new Request("https://app.example/api/upload", init));
      assertEquals(response.status, 413);
      await response.arrayBuffer();
      await canceled.promise;
    } finally {
      await pair.close();
    }
  });

  it("propagates cancellation into application execution without waiting for headers", async () => {
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const pair = connect(async (request) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => {
          aborted.resolve();
          resolve();
        }, { once: true })
      );
      request.signal.throwIfAborted();
      return new Response("unreachable");
    });
    try {
      const controller = new AbortController();
      const pending = pair.client.fetch(
        new Request("https://app.example/api/wait", { signal: controller.signal }),
      );
      const rejected = assertRejects(() => pending);
      await entered.promise;
      controller.abort();
      await rejected;
      await aborted.promise;
    } finally {
      await pair.close();
    }
  });

  it("does not reveal application error details or execute again after closing", async () => {
    let calls = 0;
    const pair = connect(() => {
      calls++;
      throw new Error("synthetic-private-detail");
    });
    try {
      const error = await assertRejects(() =>
        pair.client.fetch(new Request("https://app.example/api/fail"))
      );
      assert(error instanceof Error);
      assert(!error.message.includes("synthetic-private-detail"));
      await pair.client.close();
      await assertRejects(() => pair.client.fetch(new Request("https://app.example/api/fail")));
      assertEquals(calls, 1);
    } finally {
      await pair.close();
    }
  });

  it("does not restore response cookies named by the Connection header", async () => {
    const pair = connect(() =>
      new Response("ok", {
        headers: [["connection", "set-cookie"], ["set-cookie", "hop-cookie=private"]],
      })
    );
    try {
      const response = await pair.client.fetch(new Request("https://app.example/api/data"));
      assertEquals(response.headers.getSetCookie(), []);
      await response.text();
    } finally {
      await pair.close();
    }
  });

  it("cancels an unread upload on abort after headers even when the response is unread", async () => {
    let uploadCanceled = false;
    const childAborted = Promise.withResolvers<void>();
    const pair = connect((request) => {
      request.signal.addEventListener("abort", () => childAborted.resolve(), { once: true });
      return new Response(new ReadableStream({}));
    });
    try {
      const controller = new AbortController();
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          uploadCanceled = true;
        },
      });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        body,
        signal: controller.signal,
        duplex: "half",
      };
      const response = await pair.client.fetch(new Request("https://app.example/api/upload", init));
      assertEquals(response.status, 200);
      controller.abort();
      await childAborted.promise;
      assertEquals(uploadCanceled, true);
    } finally {
      await pair.close();
    }
  });

  it("rejects a foreign generation before invoking the project handler", async () => {
    let calls = 0;
    const operation = createExecutorHttpOperation({
      binding,
      channel: () => {
        throw new Error("Channel must not be used");
      },
      handle: () => {
        calls++;
        return new Response("unexpected");
      },
    });
    assert(operation.mode === "stream");
    const stream = operation.handle({
      id: crypto.randomUUID(),
      url: "https://app.example/api/data",
      method: "GET",
      headers: [],
      body: false,
    }, {
      binding: { ...binding, generation: 2 },
      signal: new AbortController().signal,
      deadline: Date.now() + 1000,
    });
    await assertRejects(() => stream[Symbol.asyncIterator]().next());
    assertEquals(calls, 0);
  });

  it("finishes HEAD when the handler returns one branch of a cloned response", async () => {
    const original = new Response(new ReadableStream<Uint8Array>({}));
    const clone = original.clone();
    const pair = connect(() => clone);
    const deadline = Promise.withResolvers<never>();
    const timer = setTimeout(
      () => deadline.reject(new Error("HEAD waited for the unrelated response branch")),
      1000,
    );
    try {
      const response = await Promise.race([
        pair.client.fetch(new Request("https://app.example/api/head", { method: "HEAD" })),
        deadline.promise,
      ]);
      assertEquals(response.status, 200);
      assertEquals(response.body, null);
    } finally {
      clearTimeout(timer);
      await original.body!.cancel();
      await pair.close();
    }
  });

  it("rejects malformed peer response bytes without returning their contents", async () => {
    const pair = connect(() => new Response("unused"), {
      mode: "stream",
      async *handle(): AsyncGenerator<JsonValue> {
        yield { type: "head", status: 200, statusText: "", headers: [], body: true };
        yield { type: "chunk", data: "synthetic-invalid-base64" };
      },
    });
    try {
      const response = await pair.client.fetch(new Request("https://app.example/api/data"));
      await assertRejects(() => response.arrayBuffer(), Error, "Invalid executor HTTP message");
    } finally {
      await pair.close();
    }
  });

  it("rejects a peer body following a bodyless response", async () => {
    const pair = connect(() => new Response("unused"), {
      mode: "stream",
      async *handle(): AsyncGenerator<JsonValue> {
        yield { type: "head", status: 204, statusText: "", headers: [], body: false };
        yield { type: "chunk", data: "YQ==" };
      },
    });
    try {
      await assertRejects(
        () => pair.client.fetch(new Request("https://app.example/api/data")),
        Error,
        "Invalid executor HTTP message",
      );
    } finally {
      await pair.close();
    }
  });

  it("returns custom spans under the supplied request parent without collector credentials", async () => {
    const tracer = trace.getTracer("cached-http-tracer");
    const pair = connect(() => {
      const span = tracer.startSpan("isolated.http.custom");
      span.end();
      return new Response("ok");
    });
    const batches: string[] = [];
    try {
      const response = await pair.client.fetch(new Request("https://app.example/api/data"), {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        onRecords: (records) => batches.push(records),
      });
      assertEquals(await response.text(), "ok");
      assertEquals(batches.length, 1);
      const records = JSON.parse(batches[0]!);
      assertEquals(records.length, 1);
      assertEquals(records[0].name, "isolated.http.custom");
      assertEquals(records[0].traceId, "11111111111111111111111111111111");
      assertEquals(records[0].parentSpanId, "2222222222222222");
    } finally {
      await pair.close();
    }
  });

  it("keeps trace delivery failures outside the application response", async () => {
    const pair = connect(() => new Response("unchanged"));
    try {
      const response = await pair.client.fetch(new Request("https://app.example/api/data"), {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        onRecords: () => {
          throw new Error("Synthetic collector failure");
        },
      });
      assertEquals(await response.text(), "unchanged");
    } finally {
      await pair.close();
    }
  });

  it("records spans created while consuming the response stream", async () => {
    const tracer = trace.getTracer("streaming-http-tracer");
    const pair = connect(() =>
      new Response(
        new ReadableStream({
          pull(controller) {
            tracer.startSpan("isolated.http.stream").end();
            controller.enqueue(new TextEncoder().encode("streamed"));
            controller.close();
          },
        }, { highWaterMark: 0 }),
      )
    );
    let records = "[]";
    try {
      const response = await pair.client.fetch(new Request("https://app.example/api/stream"), {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        onRecords: (value) => {
          records = value;
        },
      });
      assertEquals(await response.text(), "streamed");
      assertEquals(JSON.parse(records).map((record: { name: string }) => record.name), [
        "isolated.http.stream",
      ]);
    } finally {
      await pair.close();
    }
  });

  it("keeps concurrent response trace records paired with their original request", async () => {
    const tracer = trace.getTracer("concurrent-http-tracer");
    const pair = connect(async () => {
      await Promise.resolve();
      tracer.startSpan("isolated.http.concurrent").end();
      return new Response("ok");
    });
    try {
      await Promise.all(Array.from({ length: 12 }, async (_, index) => {
        const traceId = (index + 1).toString(16).padStart(32, "0");
        let records = "[]";
        const response = await pair.client.fetch(
          new Request("https://app.example/api/concurrent"),
          {
            traceparent: `00-${traceId}-2222222222222222-01`,
            onRecords: (value) => {
              records = value;
            },
          },
        );
        assertEquals(await response.text(), "ok");
        const captured = JSON.parse(records);
        assertEquals(captured.length, 1);
        assertEquals(captured[0].traceId, traceId);
      }));
    } finally {
      await pair.close();
    }
  });
});
