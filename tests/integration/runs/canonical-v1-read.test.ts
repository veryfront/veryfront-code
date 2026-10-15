import { VeryfrontError } from "#veryfront/errors/types.ts";
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
  for (
    const testCase of [
      {
        name: "JSON context UTF-8 bytes",
        valid: { context: [{ type: "json", data: { text: "x".repeat(16373) } }] },
        invalid: { context: [{ type: "json", data: { text: "x".repeat(16374) } }] },
      },
      {
        name: "source UTF-16 string length",
        valid: { context: [{ type: "text", text: "😀".repeat(8192) }] },
        invalid: { context: [{ type: "text", text: "😀".repeat(8193) }] },
      },
      {
        name: "source trim parse output",
        valid: {
          integrationConnectionBindings: [{
            integration: "github",
            connectionId: "00000000-0000-4000-8000-000000000001",
            connectionGenerationId: "00000000-0000-4000-8000-000000000002",
            ownerId: "00000000-0000-4000-8000-000000000003",
            scope: "user",
            ownerKind: "user",
          }],
        },
        invalid: {
          integrationConnectionBindings: [{
            integration: " github ",
            connectionId: "00000000-0000-4000-8000-000000000001",
            connectionGenerationId: "00000000-0000-4000-8000-000000000002",
            ownerId: "00000000-0000-4000-8000-000000000003",
            scope: "user",
            ownerKind: "user",
          }],
        },
      },
    ]
  ) {
    it(`enforces ${testCase.name} through get, list and SSE without mutating history`, async () => {
      for (
        const view of testCase.name === "source trim parse output"
          ? ["diagnostic"]
          : ["public", "diagnostic"]
      ) {
        for (const accepted of [true, false]) {
          const type = "com.veryfront.run.requested";
          const member = {
            ...canonical,
            metadata: { ...metadata, view },
            event: {
              ...canonical.event,
              type,
              dataschema: `urn:veryfront:events:1:data:run.requested:${view}`,
              data: {
                type,
                messages: [],
                agentSource: { type: "branch", branch: "main" },
                tools: [],
                context: [],
                ...(view === "diagnostic" ? { integrationConnectionBindings: [] } : {}),
                ...(accepted ? testCase.valid : testCase.invalid),
              },
            },
          };
          await fixture((request) => {
            const path = new URL(request.url).pathname;
            if (path.endsWith("/stream")) {
              return new Response(`id: 41\nevent: ${type}\ndata: ${JSON.stringify(member)}\n\n`);
            }
            return Response.json(
              path.endsWith("/41") ? member : {
                entries: [member],
                next_cursor: null,
                has_more: false,
              },
            );
          }, async (sdk) => {
            if (accepted) {
              assertEquals<unknown>(await sdk.canonicalEventsV1.get("run_demo", "41"), member);
              assertEquals<unknown>((await sdk.canonicalEventsV1.list("run_demo")).entries, [
                member,
              ]);
              const observed = [];
              for await (const value of sdk.canonicalEventsV1.stream("run_demo")) {
                observed.push(value);
              }
              assertEquals<unknown>(observed, [member]);
            } else {
              await assertRejects(() => sdk.canonicalEventsV1.get("run_demo", "41"), TypeError);
              await assertRejects(() => sdk.canonicalEventsV1.list("run_demo"), TypeError);
              await assertRejects(async () => {
                for await (const _ of sdk.canonicalEventsV1.stream("run_demo")) {
                  /* No accepted member outside its selected source contract. */
                }
              }, TypeError);
            }
          });
        }
      }
    });
  }

  it("reads contract-sized diagnostic model inputs through get, list and SSE", async () => {
    for (
      const content of ["x".repeat(1_500_000), "😀".repeat(1_200_000), "x".repeat(9 * 1024 * 1024)]
    ) {
      const type = "com.veryfront.model-call.input.captured";
      const member = {
        ...canonical,
        metadata: { ...metadata, view: "diagnostic" },
        event: {
          ...canonical.event,
          type,
          dataschema: "urn:veryfront:events:1:data:model-call.input.captured:diagnostic",
          data: { type, messages: [{ role: "system", content }] },
        },
      };
      await fixture((request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/stream")) {
          return new Response(`id: 41\nevent: ${type}\ndata: ${JSON.stringify(member)}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return Response.json(
          path.endsWith("/41") ? member : { entries: [member], next_cursor: null, has_more: false },
        );
      }, async (sdk) => {
        assertEquals<unknown>(await sdk.canonicalEventsV1.get("run_demo", "41"), member);
        assertEquals<unknown>((await sdk.canonicalEventsV1.list("run_demo")).entries, [member]);
        const observed = [];
        for await (const value of sdk.canonicalEventsV1.stream("run_demo")) observed.push(value);
        assertEquals<unknown>(observed, [member]);
      });
    }
  });

  it("rejects oversized canonical strings and aggregate JSON through every read path", async () => {
    const type = "com.veryfront.model-call.input.captured";
    for (
      const messages of [
        [{ role: "system", content: "x".repeat(10 * 1024 * 1024 + 1) }],
        Array.from({ length: 2 }, () => ({ role: "system", content: "x".repeat(6 * 1024 * 1024) })),
      ]
    ) {
      const member = {
        ...canonical,
        metadata: { ...metadata, view: "diagnostic" },
        event: {
          ...canonical.event,
          type,
          dataschema: "urn:veryfront:events:1:data:model-call.input.captured:diagnostic",
          data: { type, messages },
        },
      };
      await fixture((request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/stream")) {
          return new Response(`id: 41\nevent: ${type}\ndata: ${JSON.stringify(member)}\n\n`);
        }
        return Response.json(
          path.endsWith("/41") ? member : { entries: [member], next_cursor: null, has_more: false },
        );
      }, async (sdk) => {
        await assertRejects(() => sdk.canonicalEventsV1.get("run_demo", "41"), TypeError);
        await assertRejects(() => sdk.canonicalEventsV1.list("run_demo"), TypeError);
        await assertRejects(async () => {
          for await (
            const _ of sdk.canonicalEventsV1.stream("run_demo")
          ) { /* No accepted oversized member. */ }
        }, TypeError);
      });
    }
  });
  it("bounds canonical SSE frames by UTF-8 bytes before parsing", async () => {
    await fixture(
      () => new Response(new TextEncoder().encode(`:${"😀".repeat(3_150_000)}\n\n`)),
      async (sdk) => {
        await assertRejects(
          async () => {
            for await (const _ of sdk.canonicalEventsV1.stream("run_demo")) {
              /* No accepted oversized frame. */
            }
          },
          TypeError,
          "canonical-v1 SSE frame is too large",
        );
      },
    );
  });
  it("selects the binding explicitly and preserves mixed history and exact returned cursor", async () => {
    await fixture((request) => {
      const url = new URL(request.url);
      assertEquals(url.searchParams.get("event_representation"), "canonical-v1");
      assertEquals(url.searchParams.has("cursor_profile"), false);
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
        await assertRejects(
          () => sdk.canonicalEventsV1.get("run_other", String(member.metadata.event_id)),
          TypeError,
          "run identity mismatch",
        );
      });
    }
  });
  it("scopes list and durable stream members to the requested run", async () => {
    for (const member of [canonical, legacy]) {
      await fixture(
        (request) =>
          Response.json({
            entries: [member],
            next_cursor: null,
            has_more: false,
            ...(new URL(request.url).searchParams.get("include_descendants") === "true"
              ? { cursor_profile: "run-events-descendants-v1" }
              : {}),
          }),
        async (sdk) => {
          for (const query of [{}, { include_descendants: false }]) {
            await assertRejects(
              () => sdk.canonicalEventsV1.list("run_other", query),
              TypeError,
              "run identity mismatch",
            );
          }
          const descendants = await sdk.canonicalEventsV1.list("run_other", {
            include_descendants: true,
          });
          assertEquals(descendants.entries.length, 1);
        },
      );
      const eventName = member.kind === "legacy" ? "legacy" : canonical.event.type;
      await fixture(
        () =>
          new Response(
            `event: ${eventName}\nid: ${member.metadata.event_id}\ndata: ${
              JSON.stringify(member)
            }\n\n`,
          ),
        async (sdk) => {
          await assertRejects(
            () => sdk.canonicalEventsV1.stream("run_other")[Symbol.asyncIterator]().next(),
            TypeError,
            "run identity mismatch",
          );
        },
      );
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
      () => new Response(`event: ${transient.event.type}\ndata: ${JSON.stringify(transient)}\n\n`),
      async (sdk) => {
        await assertRejects(
          () => sdk.canonicalEventsV1.stream("run_other")[Symbol.asyncIterator]().next(),
          TypeError,
          "run identity mismatch",
        );
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
  await assertRejects(() => facade.list("run_demo"), VeryfrontError);
});

for (const ids of [[42], [41], [43, 43], [43, 42]]) {
  it(`rejects durable stream IDs that do not advance checkpoint 42: ${ids}`, async () => {
    const frames = ids.map((id) => {
      const member = { ...legacy, metadata: { ...legacy.metadata, event_id: id } };
      return `event: legacy\nid: ${id}\ndata: ${JSON.stringify(member)}\n\n`;
    }).join("");
    const facade = createCanonicalEventsV1Facade({
      async request() {
        return new Response(frames);
      },
    });
    const yielded: number[] = [];
    await assertRejects(
      async () => {
        for await (const member of facade.stream("run_demo", "42")) {
          if (member.kind !== "transient") yielded.push(member.metadata.event_id);
        }
      },
      TypeError,
      "Durable stream event ID must increase",
    );
    assertEquals(yielded, ids.length === 1 ? [] : [43]);
  });
}

for (
  const [query, ids] of [
    [{}, [43, 42]],
    [{ sort_order: "asc", after_event_id: 41 }, [43, 42]],
    [{ sort_order: "asc", cursor: "41" }, [41, 42]],
    [{ sort_order: "asc", cursor: "41" }, [40]],
    [{ sort_order: "desc", cursor: "43" }, [43]],
    [{ sort_order: "desc", cursor: "43" }, [41, 42]],
    [{}, [42, 42]],
  ] as const
) {
  it(`rejects list positions outside requested cursor ordering: ${JSON.stringify(query)} ${ids}`, async () => {
    const entries = ids.map((event_id) => ({
      ...legacy,
      metadata: { ...legacy.metadata, event_id },
    }));
    const facade = createCanonicalEventsV1Facade({
      async request() {
        return { entries, next_cursor: String(ids.at(-1)), has_more: true };
      },
    });
    await assertRejects(
      () => facade.list("run_demo", query),
      TypeError,
      "List event IDs must advance in the requested order",
    );
  });
}

it("preserves valid ascending and descending list continuations", async () => {
  for (
    const [query, ids] of [
      [{ cursor: "41", sort_order: "asc" }, [42, 43]],
      [{ cursor: "43", sort_order: "desc" }, [42, 41]],
      [{ after_event_id: 41 }, [42, 43]],
    ] as const
  ) {
    const entries = ids.map((event_id) => ({
      ...legacy,
      metadata: { ...legacy.metadata, event_id },
    }));
    const facade = createCanonicalEventsV1Facade({
      async request() {
        return { entries, next_cursor: String(ids.at(-1)), has_more: true };
      },
    });
    assertEquals(
      (await facade.list("run_demo", query)).entries.map((member) => member.metadata.event_id),
      [...ids],
    );
  }
});

for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
  for (
    const body of [
      "<html>private-response</html>",
      '{"message":"private-response"}',
      "private-response".repeat(5000),
      new Uint8Array([0xff]),
      null,
    ]
  ) {
    it(`preserves HTTP ${status} retry policy for malformed canonical errors (${body === null ? "empty" : typeof body === "string" ? body.length : "invalid UTF-8"})`, async () => {
      let attempts = 0;
      await fixture(() => {
        attempts++;
        return new Response(body, { status });
      }, async (sdk) => {
        const error = await assertRejects(
          () => sdk.canonicalEventsV1.list("run_demo"),
          VeryfrontError,
        );
        if (!(error instanceof VeryfrontError)) throw new Error("Expected HTTP error");
        assertEquals(error.status, status);
        assertEquals(error instanceof CanonicalEventsV1Error, false);
        assertEquals(JSON.stringify(error).includes("private-response"), false);
        assertEquals(error.message.includes("private-response"), false);
      });
      assertEquals(attempts, status === 429 || status >= 500 ? 3 : 1);
    });
  }
}

function descendantToken(runId: string, id: number, sortOrder = "asc") {
  return "vfd1." + btoa(JSON.stringify({
    version: 1,
    root_run_id: "run_demo",
    producing_run_id: runId,
    view: "public",
    sort_order: sortOrder,
    filters_digest: "a".repeat(64),
    event_id: String(id),
    store: runId === "child_task" ? "run_execution_event" : "agent_run_event",
  })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
describe("canonical descendant pagination profile", () => {
  for (const sort_order of ["asc", "desc"] as const) {
    it(`preserves equal physical IDs across stores and pages (${sort_order})`, async () => {
      const rows = ["child_agent", "child_task"].map((run_id) => ({
        ...legacy,
        metadata: { ...metadata, run_id, event_id: 42 },
      }));
      const next = descendantToken("child_agent", 42, sort_order);
      let calls = 0;
      await fixture((request) => {
        const url = new URL(request.url);
        assertEquals(url.searchParams.get("cursor_profile"), "run-events-descendants-v1");
        calls++;
        if (calls === 1) {
          return Response.json({
            cursor_profile: "run-events-descendants-v1",
            entries: [rows[0]],
            next_cursor: next,
            has_more: true,
          });
        }
        assertEquals(url.searchParams.get("cursor"), next);
        return Response.json({
          cursor_profile: "run-events-descendants-v1",
          entries: [rows[1]],
          next_cursor: null,
          has_more: false,
        });
      }, async (sdk) => {
        const first = await sdk.canonicalEventsV1.list("run_demo", {
          include_descendants: true,
          sort_order,
          limit: 1,
        });
        const second = await sdk.canonicalEventsV1.list("run_demo", {
          include_descendants: true,
          sort_order,
          limit: 1,
          cursor: first.next_cursor ?? undefined,
        });
        assertEquals([...first.entries, ...second.entries].map((x) => x.metadata.run_id), [
          "child_agent",
          "child_task",
        ]);
      });
    });
  }
  it("accepts equal IDs from distinct producers in one page", async () => {
    await fixture(
      () =>
        Response.json({
          cursor_profile: "run-events-descendants-v1",
          entries: ["child_agent", "child_task"].map((run_id) => ({
            ...legacy,
            metadata: { ...metadata, event_id: 42, run_id },
          })),
          next_cursor: null,
          has_more: false,
        }),
      async (sdk) =>
        assertEquals(
          (await sdk.canonicalEventsV1.list("run_demo", { include_descendants: true })).entries
            .length,
          2,
        ),
    );
  });
  it("rejects mixed profiles, duplicate identity, and inconsistent continuation", async () => {
    for (
      const page of [
        { entries: [legacy], next_cursor: null, has_more: false },
        {
          cursor_profile: "run-events-descendants-v1",
          entries: [legacy, legacy],
          next_cursor: null,
          has_more: false,
        },
        {
          cursor_profile: "run-events-descendants-v1",
          entries: [legacy],
          next_cursor: descendantToken("child_task", 42),
          has_more: true,
        },
      ]
    ) {
      await fixture(() => Response.json(page), async (sdk) => {
        await assertRejects(
          () => sdk.canonicalEventsV1.list("run_demo", { include_descendants: true }),
          TypeError,
        );
      });
    }
    await fixture(
      () =>
        Response.json({
          cursor_profile: "run-events-descendants-v1",
          entries: [legacy],
          next_cursor: null,
          has_more: false,
        }),
      async (sdk) => {
        await assertRejects(() => sdk.canonicalEventsV1.list("run_demo"), TypeError);
      },
    );
  });
  it("surfaces authoritative server scope rejection without reinterpretation", async () => {
    await fixture(
      () =>
        Response.json({ code: "INVALID_EVENT_REQUEST", message: "Invalid cursor scope" }, {
          status: 400,
        }),
      async (sdk) => {
        const error = await assertRejects(() =>
          sdk.canonicalEventsV1.list("other_root", {
            include_descendants: true,
            cursor: descendantToken("child_task", 42),
          }), CanonicalEventsV1Error);
        assertEquals(error.problem.code, "INVALID_EVENT_REQUEST");
      },
    );
  });
});

it("keeps numeric after_event_id exclusive before allowing equal descendant IDs", async () => {
  await fixture(
    () =>
      Response.json({
        cursor_profile: "run-events-descendants-v1",
        entries: [{ ...legacy, metadata: { ...metadata, event_id: 42, run_id: "child_task" } }],
        next_cursor: null,
        has_more: false,
      }),
    async (sdk) => {
      await assertRejects(
        () =>
          sdk.canonicalEventsV1.list("run_demo", { include_descendants: true, after_event_id: 42 }),
        TypeError,
        "after_event_id",
      );
    },
  );
});
