import "../../../src/events/test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  CanonicalEventsV1Error,
  CanonicalEventsV1StreamError,
  createRunsApiTransport,
  createRunsSdk,
} from "#veryfront/runs/target/index.ts";
const metadata = {
  event_id: 41,
  run_id: "run_demo",
  storage: "persisted",
  view: "public",
  recorded_at: "2026-10-05T10:00:01Z",
  event_class: "fact",
  is_error: null,
  span_id: null,
  turn_id: null,
  unrecoverable_fields: [],
};
const canonical = {
  kind: "canonical",
  metadata,
  event: {
    specversion: "1.0",
    vfversion: "1",
    id: "41",
    source: "https://api.example/runs/run_demo",
    subject: "run_demo",
    runid: "run_demo",
    runkind: "agent",
    recordedat: metadata.recorded_at,
    type: "com.veryfront.run.started",
    datacontenttype: "application/json",
    dataschema: "urn:veryfront:events:1:data:run.started:public",
    data: { type: "com.veryfront.run.started" },
  },
};
const legacy = {
  kind: "legacy",
  reason: "unknown_type",
  legacy: { event_type: "CUSTOM\nevent: injected", payload: { public: true } },
  metadata: { ...metadata, event_id: 42 },
};
async function fixture(
  body: (request: Request) => Response,
  run: (sdk: ReturnType<typeof createRunsSdk>) => Promise<void>,
) {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, body);
  try {
    await run(
      createRunsSdk({
        transport: createRunsApiTransport({
          baseUrl: `http://127.0.0.1:${server.addr.port}`,
          getToken: () => "",
          authMode: "none",
          retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
        }),
      }),
    );
  } finally {
    await server.shutdown();
  }
}
describe("canonical-v1 real HTTP and SSE reads", () => {
  it("selects the binding explicitly and preserves mixed history and exact returned cursor", async () => {
    await fixture((request) => {
      const url = new URL(request.url);
      assertEquals(url.searchParams.get("event_representation"), "canonical-v1");
      assertEquals(url.pathname, "/runs/run_demo/events");
      return Response.json({ entries: [canonical, legacy], next_cursor: "42", has_more: true });
    }, async (sdk) => {
      const page = await sdk.canonicalEventsV1.list("run_demo", { limit: 2 });
      assertEquals(page.entries.map((member) => member.kind), ["canonical", "legacy"]);
      assertEquals(page.next_cursor, "42");
    });
  });
  it("rejects a get response for another event in canonical and legacy history", async () => {
    for (const member of [canonical, legacy]) {
      await fixture(() => Response.json(member), async (sdk) => {
        await assertRejects(
          () => sdk.canonicalEventsV1.get("run_demo", "43"),
          TypeError,
          "event identity mismatch",
        );
        const matching = await sdk.canonicalEventsV1.get(
          "run_demo",
          String(member.metadata.event_id),
        );
        assertEquals(matching.metadata.event_id, member.metadata.event_id);
      });
    }
  });
  it("uses global discovery and exposes structured pre-open errors", async () => {
    await fixture((request) => {
      const url = new URL(request.url);
      assertEquals(url.pathname, "/runs/event-types");
      assertEquals(url.searchParams.get("event_representation"), "canonical-v1");
      return Response.json({ version: "1", revision: "1.0-draft.8", events: [] });
    }, async (sdk) => {
      assertEquals((await sdk.canonicalEventsV1.discover()).version, "1");
    });
    await fixture(
      () =>
        Response.json({
          code: "DURABLE_STREAM_UNAVAILABLE",
          message: "Derived history cannot resume",
        }, { status: 409 }),
      async (sdk) => {
        const error = await assertRejects(async () => {
          for await (const member of sdk.canonicalEventsV1.stream("run_demo")) {
            throw new Error(`Unexpected ${member.kind}`);
          }
        }, CanonicalEventsV1Error);
        if (!(error instanceof CanonicalEventsV1Error)) {
          throw new Error("Expected canonical-v1 error");
        }
        assertEquals(error.problem.code, "DURABLE_STREAM_UNAVAILABLE");
        assertEquals(error.status, 409);
      },
    );
  });
  it("does not retry user header callbacks and accepts CR-delimited final frames", async () => {
    let requests = 0;
    const callbackError = new Error("User callback failed");
    await fixture(() => {
      requests++;
      return Response.json({ entries: [], next_cursor: null, has_more: false });
    }, async (sdk) => {
      try {
        await sdk.canonicalEventsV1.list("run_demo", {}, {
          onHeaders() {
            throw callbackError;
          },
        });
      } catch (error) {
        assertEquals(error, callbackError);
      }
      assertEquals(requests, 1);
    });
    await fixture(
      () =>
        new Response(`event: legacy\rid: 42\rdata: ${JSON.stringify(legacy)}\r\r: keepalive\r\r`),
      async (sdk) => {
        const members = [];
        for await (const member of sdk.canonicalEventsV1.stream("run_demo")) members.push(member);
        assertEquals(members.map((member) => member.kind), ["legacy"]);
      },
    );
  });
  it("resumes persisted legacy rows and throws post-open failure rather than EOF", async () => {
    await fixture((request) => {
      assertEquals(request.headers.get("last-event-id"), "41");
      return new Response(
        `: keepalive\n\nevent: legacy\nid: 42\ndata: ${
          JSON.stringify(legacy)
        }\n\nevent: error\ndata: {"code":"SERVICE_UNAVAILABLE","message":"Stream unavailable"}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    }, async (sdk) => {
      const iterator = sdk.canonicalEventsV1.stream("run_demo", "41")[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value?.kind, "legacy");
      await assertRejects(() => iterator.next(), CanonicalEventsV1StreamError);
    });
  });
  it("keeps transient live identities outside durable cursors", async () => {
    const transient = {
      kind: "transient",
      view: "public",
      event: {
        ...canonical.event,
        id: "live:1",
        source: "https://api.example/runs/run_demo/streams/session_one",
        time: metadata.recorded_at,
        recordedat: undefined,
        type: "com.veryfront.stream.heartbeat.emitted",
        dataschema: "urn:veryfront:events:1:data:stream.heartbeat.emitted:public",
        data: {
          type: "com.veryfront.stream.heartbeat.emitted",
          runId: "run_demo",
          lastEventId: 42,
        },
      },
    };
    await fixture(
      () =>
        new Response(`event: ${transient.event.type}\ndata: ${JSON.stringify(transient)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      async (sdk) => {
        const members = [];
        for await (const member of sdk.canonicalEventsV1.stream("run_demo")) members.push(member);
        assertEquals(members.map((member) => member.kind), ["transient"]);
      },
    );
    await fixture(
      () =>
        new Response(
          `event: ${transient.event.type}\nid: 42\ndata: ${JSON.stringify(transient)}\n\n`,
        ),
      async (sdk) => {
        await assertRejects(async () => {
          for await (const _member of sdk.canonicalEventsV1.stream("run_demo")) {
            throw new Error("Invalid transient frame must not be yielded");
          }
        }, TypeError);
      },
    );
  });
  it("rejects schema/view disagreement and metadata owner forgery", async () => {
    for (
      const event of [
        { ...canonical.event, dataschema: "urn:veryfront:events:1:data:run.started:diagnostic" },
        { ...canonical.event, subject: "other" },
        { ...canonical.event, source: "https://api.example/runs/run_demo/extra" },
      ]
    ) {
      await fixture(() => Response.json({ ...canonical, event }), async (sdk) => {
        await assertRejects(() => sdk.canonicalEventsV1.get("run_demo", "41"), TypeError);
      });
    }
  });
});

import { createCanonicalEventsV1Facade } from "#veryfront/runs/target/index.ts";
it("aborts an idle response independently of transport cancellation", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const controller = new AbortController();
  const facade = createCanonicalEventsV1Facade({
    async request() {
      return new Response(body);
    },
  });
  const iterator = facade.stream("run_demo", "0", { signal: controller.signal })
    [Symbol.asyncIterator]();
  const pending = iterator.next();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assertRejects(() => pending, DOMException);
  assertEquals(cancelled, true);
});

it("cancels an unopened stream body when the header callback fails", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const facade = createCanonicalEventsV1Facade({
    async request(_path, init) {
      if (!init?.onResponse) throw new Error("Missing response decoder");
      return await init.onResponse(
        response,
        init,
        "https://api.example",
        new AbortController().signal,
      );
    },
  });
  const callbackError = new Error("Headers failed");
  const iterator = facade.stream("run_demo", "0", {
    onHeaders() {
      throw callbackError;
    },
  })[Symbol.asyncIterator]();
  try {
    await iterator.next();
    throw new Error("Expected callback exception");
  } catch (error) {
    assertEquals(error, callbackError);
  }
  assertEquals(cancelled, true);
});
it("aborts an idle structured HTTP error body", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }),
    { status: 409 },
  );
  const controller = new AbortController();
  const facade = createCanonicalEventsV1Facade({
    async request(_path, init) {
      if (!init?.onResponse) throw new Error("Missing decoder");
      return await init.onResponse(response, init, "https://api.example", controller.signal);
    },
  });
  const pending = facade.list("run_demo", {}, { signal: controller.signal });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assertRejects(() => pending, DOMException);
  assertEquals(cancelled, true);
});
it("decodes HTTP errors when a conforming transport omits its optional signal", async () => {
  const facade = createCanonicalEventsV1Facade({
    async request(_path, init) {
      if (!init?.onResponse) throw new Error("Missing decoder");
      return await init.onResponse(
        Response.json({ code: "EVENT_NOT_FOUND", message: "Event unavailable" }, { status: 404 }),
        init,
        "https://api.example",
      );
    },
  });
  await assertRejects(() => facade.get("run_demo", "42"), CanonicalEventsV1Error);
});

it("rejects invalid UTF-8 instead of yielding altered event history", async () => {
  const text = `event: legacy\nid: 42\ndata: ${JSON.stringify(legacy)}\n\n`;
  const bytes = new TextEncoder().encode(text);
  const marker = new TextEncoder().encode("CUSTOM");
  const at = bytes.findIndex((_byte, index) =>
    marker.every((value, offset) => bytes[index + offset] === value)
  );
  if (at < 0) throw new Error("Expected fixture text marker");
  bytes[at] = 0xff;
  const facade = createCanonicalEventsV1Facade({
    async request() {
      return new Response(bytes);
    },
  });
  await assertRejects(async () => {
    for await (const _member of facade.stream("run_demo")) {
      throw new Error("Malformed UTF-8 must never yield a member");
    }
  }, TypeError);
});

it("stops buffered canonical stream delivery after cancellation", async () => {
  const controller = new AbortController();
  const frame = `event: legacy\nid: 42\ndata: ${JSON.stringify(legacy)}\n\n`;
  const facade = createCanonicalEventsV1Facade({
    async request() {
      return new Response(frame + frame);
    },
  });
  const iterator = facade.stream("run_demo", "0", { signal: controller.signal })
    [Symbol.asyncIterator]();
  assertEquals((await iterator.next()).value?.kind, "legacy");
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assertRejects(() => iterator.next(), DOMException);
});

it("rejects invalid UTF-8 in structured HTTP errors", async () => {
  const bytes = new TextEncoder().encode('{"code":"UNAVAILABLE","message":"invalid"}');
  bytes[bytes.indexOf(105)] = 0xff;
  const facade = createCanonicalEventsV1Facade({
    async request(_path, init) {
      if (!init?.onResponse) throw new Error("Missing response decoder");
      return init.onResponse(new Response(bytes, { status: 503 }), init, "https://api.example");
    },
  });
  await assertRejects(() => facade.list("run_demo"), TypeError);
});
