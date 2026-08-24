import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createContext } from "#veryfront/routing";
import { createValidatedHandler } from "./handler.ts";

function jsonRequest(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Request {
  const json = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(json).length),
      ...headers,
    },
    body: json,
  });
}

function streamingRequest(
  body: ReadableStream<Uint8Array>,
  headers?: HeadersInit,
): Request {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body,
    duplex: "half",
  };
  return new Request("http://localhost/api/test", init);
}

/**
 * Build the object the pages-router executor actually hands an API handler.
 *
 * A validated handler mounted as `export const POST = createValidatedHandler(...)`
 * is invoked by `routing/api/route-executor.ts` with the `APIContext` it builds,
 * *not* a raw `Request`. On that context `.body` is a reader **function**, so a
 * handler that treats it as a `Request` and reads `.body.getReader()` throws
 * `request.body?.getReader is not a function` (issue #3666).
 */
function pagesContext(request: Request) {
  return createContext(
    request,
    { params: {} } as unknown as Parameters<typeof createContext>[1],
    {} as unknown as Parameters<typeof createContext>[2],
  );
}

describe("security/input-validation/handler", () => {
  describe("createValidatedHandler", () => {
    it("should validate body and pass to handler", async () => {
      const bodySchema = defineSchema((v) => v.object({ name: v.string() }))();

      const handler = createValidatedHandler(
        { body: bodySchema },
        (_req, validated) =>
          new Response(JSON.stringify(validated.body), {
            headers: { "Content-Type": "application/json" },
          }),
      );

      const req = jsonRequest("http://localhost/api/test", { name: "Alice" });
      const res = await handler(req);

      assertEquals(res.status, 200);
      assertEquals((await res.json()).name, "Alice");
    });

    it("should validate query params and pass to handler", async () => {
      const querySchema = defineSchema((v) => v.object({ page: v.string() }))();

      const handler = createValidatedHandler(
        { query: querySchema },
        (_req, validated) =>
          new Response(JSON.stringify(validated.query), {
            headers: { "Content-Type": "application/json" },
          }),
      );

      const req = new Request("http://localhost/api/test?page=5");
      const res = await handler(req);

      assertEquals(res.status, 200);
      assertEquals((await res.json()).page, "5");
    });

    it("should validate both body and query", async () => {
      const bodySchema = defineSchema((v) => v.object({ name: v.string() }))();
      const querySchema = defineSchema((v) => v.object({ format: v.string() }))();

      const handler = createValidatedHandler(
        { body: bodySchema, query: querySchema },
        (_req, validated) =>
          new Response(
            JSON.stringify({ body: validated.body, query: validated.query }),
            { headers: { "Content-Type": "application/json" } },
          ),
      );

      const req = jsonRequest("http://localhost/api/test?format=json", {
        name: "Bob",
      });
      const res = await handler(req);
      const data = await res.json();

      assertEquals(res.status, 200);
      assertEquals(data.body.name, "Bob");
      assertEquals(data.query.format, "json");
    });

    it("should return 400 for invalid body", async () => {
      const bodySchema = defineSchema((v) => v.object({ name: v.string() }))();

      const handler = createValidatedHandler(
        { body: bodySchema },
        () => new Response("OK"),
      );

      const req = jsonRequest("http://localhost/api/test", { name: 123 });
      const res = await handler(req);

      assertEquals(res.status, 400);
      assertEquals((await res.json()).error, "Validation failed");
    });

    it("should return 400 for invalid query params", async () => {
      const querySchema = defineSchema((v) => v.object({ page: v.string().min(1) }))();

      const handler = createValidatedHandler(
        { query: querySchema },
        () => new Response("OK"),
      );

      const req = new Request("http://localhost/api/test");
      const res = await handler(req);

      assertEquals(res.status, 400);
      assertEquals((await res.json()).error, "Query parameter validation failed");
    });

    it("should return JSON error response with Content-Type header", async () => {
      const bodySchema = defineSchema((v) => v.object({ name: v.string() }))();

      const handler = createValidatedHandler(
        { body: bodySchema },
        () => new Response("OK"),
      );

      const req = jsonRequest("http://localhost/api/test", { name: 123 });
      const res = await handler(req);

      assertEquals(res.headers.get("Content-Type"), "application/json");
    });

    it("should include error details in response", async () => {
      const bodySchema = defineSchema((v) =>
        v.object({
          name: v.string(),
          email: v.string().email(),
        })
      )();

      const handler = createValidatedHandler(
        { body: bodySchema },
        () => new Response("OK"),
      );

      const req = jsonRequest("http://localhost/api/test", {
        name: 123,
        email: "bad",
      });
      const res = await handler(req);
      const data = await res.json();

      assertEquals(Array.isArray(data.details.errors), true);
      assertEquals(data.details.errors.length >= 1, true);
    });

    it("should pass the original request to the handler", async () => {
      let receivedUrl = "";
      let receivedRequest: Request | undefined;

      const handler = createValidatedHandler({}, (req) => {
        receivedRequest = req;
        receivedUrl = req.url;
        return new Response("OK");
      });

      const req = new Request("http://localhost/api/test");
      await handler(req);

      assertEquals(receivedUrl, "http://localhost/api/test");
      assertStrictEquals(receivedRequest, req);
    });

    describe("invoked with a pages-router API context (issue #3666)", () => {
      it("reads and validates the body from ctx.request", async () => {
        const bodySchema = defineSchema((v) =>
          v.object({ name: v.string().min(1), count: v.number() })
        )();
        const handler = createValidatedHandler(
          { body: bodySchema },
          (_req, validated) =>
            new Response(JSON.stringify({ echoed: validated.body }), {
              headers: { "Content-Type": "application/json" },
            }),
        );

        const ctx = pagesContext(
          jsonRequest("http://localhost/api/validated", { name: "Ada", count: 3 }),
        );
        const res = await handler(ctx as unknown as Request);

        assertEquals(res.status, 200);
        assertEquals(await res.json(), { echoed: { name: "Ada", count: 3 } });
      });

      it("returns a schema 400 (never a body-reader crash) for an invalid body", async () => {
        const bodySchema = defineSchema((v) =>
          v.object({ name: v.string().min(1), count: v.number() })
        )();
        const handler = createValidatedHandler(
          { body: bodySchema },
          () => new Response("OK"),
        );

        const ctx = pagesContext(
          jsonRequest("http://localhost/api/validated", { name: "", count: -1 }),
        );
        const res = await handler(ctx as unknown as Request);
        const data = await res.json();

        assertEquals(res.status, 400);
        assertEquals(data.error, "Validation failed");
        // The failure must be schema validation — never the pre-validation
        // "request.body?.getReader is not a function" crash that meant no POST
        // body could be read at all.
        assertEquals(JSON.stringify(data).includes("getReader"), false);
      });

      it("passes the resolved Request (not the context) to the handler", async () => {
        let received: unknown;
        const handler = createValidatedHandler({}, (req) => {
          received = req;
          return new Response("OK");
        });
        const ctx = pagesContext(
          jsonRequest("http://localhost/api/validated", { ok: true }),
        );

        await handler(ctx as unknown as Request);

        assertInstanceOf(received, Request);
        assertStrictEquals(received, ctx.request);
      });
    });

    it("should propagate non-ValidationError errors", async () => {
      const handler = createValidatedHandler({}, () => {
        throw new TypeError("Something unexpected");
      });

      const req = new Request("http://localhost/api/test");

      try {
        await handler(req);
        throw new Error("Should have thrown");
      } catch (error) {
        assertInstanceOf(error, TypeError);
        assertEquals((error as TypeError).message, "Something unexpected");
      }
    });

    it("should handle handler returning a Response directly (non-async)", async () => {
      const handler = createValidatedHandler(
        {},
        () => new Response("sync response"),
      );

      const req = new Request("http://localhost/api/test");
      const res = await handler(req);

      assertEquals(await res.text(), "sync response");
    });

    it("should enforce limits from config", async () => {
      const bodySchema = defineSchema((v) => v.object({ data: v.string() }))();

      const handler = createValidatedHandler(
        { body: bodySchema, limits: { maxBodySize: 10 } },
        () => new Response("OK"),
      );

      const req = jsonRequest("http://localhost/api/test", {
        data: "x".repeat(200),
      });
      const res = await handler(req);

      assertEquals(res.status, 400);
    });

    it("should enforce URL limits without a body schema", async () => {
      let invoked = false;
      const handler = createValidatedHandler(
        { limits: { maxUrlLength: 32 } },
        () => {
          invoked = true;
          return new Response("OK");
        },
      );

      const res = await handler(
        new Request(`http://localhost/api/${"x".repeat(100)}`),
      );

      assertEquals(res.status, 400);
      assertEquals((await res.json()).error, "URL too long");
      assertEquals(invoked, false);
    });

    it("should enforce header limits with only a query schema", async () => {
      const querySchema = defineSchema((v) => v.object({ page: v.string() }))();
      let invoked = false;
      const handler = createValidatedHandler(
        { query: querySchema, limits: { maxHeaderSize: 32 } },
        () => {
          invoked = true;
          return new Response("OK");
        },
      );

      const res = await handler(
        new Request("http://localhost/api/test?page=1", {
          headers: { "x-large-header": "x".repeat(100) },
        }),
      );

      assertEquals(res.status, 400);
      assertEquals((await res.json()).error, "Headers too large");
      assertEquals(invoked, false);
    });

    it("should enforce declared body limits without a body schema", async () => {
      let invoked = false;
      const handler = createValidatedHandler(
        { limits: { maxBodySize: 10 } },
        () => {
          invoked = true;
          return new Response("OK");
        },
      );

      const res = await handler(
        new Request("http://localhost/api/test", {
          headers: { "content-length": "100" },
        }),
      );

      assertEquals(res.status, 400);
      assertEquals((await res.json()).error, "Request body too large");
      assertEquals(invoked, false);
    });

    it("should enforce the actual size of a chunked body without a body schema", async () => {
      let invoked = false;
      const handler = createValidatedHandler(
        { limits: { maxBodySize: 10 } },
        () => {
          invoked = true;
          return new Response("OK");
        },
      );
      const request = streamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(6)));
            controller.enqueue(new TextEncoder().encode("x".repeat(6)));
            controller.close();
          },
        }),
      );

      assertEquals(request.headers.has("content-length"), false);
      const response = await handler(request);

      assertEquals(response.status, 400);
      assertEquals(invoked, false);
    });

    it("should reject a body larger than its understated Content-Length", async () => {
      let invoked = false;
      const handler = createValidatedHandler(
        { limits: { maxBodySize: 10 } },
        () => {
          invoked = true;
          return new Response("OK");
        },
      );
      const request = streamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(100)));
            controller.close();
          },
        }),
        { "content-length": "1" },
      );

      const response = await handler(request);

      assertEquals(response.status, 400);
      assertEquals(invoked, false);
    });

    it("should cancel a still-open chunked body it rejects for size", async () => {
      let cancelled = false;
      const handler = createValidatedHandler(
        { limits: { maxBodySize: 10 } },
        () => new Response("OK"),
      );
      const request = streamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(6)));
            controller.enqueue(new TextEncoder().encode("x".repeat(6)));
            // Left open on purpose: a sender that keeps pushing must not be
            // able to hold the stream after the request has been rejected.
          },
          cancel() {
            cancelled = true;
          },
        }),
      );

      const response = await handler(request);

      assertEquals(response.status, 400);
      await waitFor(() => cancelled, {
        message: "the rejected request body must be cancelled, not left open",
      });
    });

    it("should cancel a still-open body that understates its Content-Length", async () => {
      let cancelled = false;
      const handler = createValidatedHandler(
        { limits: { maxBodySize: 10 } },
        () => new Response("OK"),
      );
      const request = streamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(100)));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { "content-length": "1" },
      );

      const response = await handler(request);

      assertEquals(response.status, 400);
      await waitFor(() => cancelled, {
        message: "the rejected request body must be cancelled, not left open",
      });
    });

    it("should leave an accepted unparsed body available to the handler", async () => {
      const handler = createValidatedHandler(
        { limits: { maxBodySize: 16 } },
        async (request) => new Response(await request.text()),
      );
      const request = streamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("bounded body"));
            controller.close();
          },
        }),
      );

      const response = await handler(request);

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "bounded body");
    });

    it("should snapshot config and schemas before awaiting a body", async () => {
      const bodySchema = defineSchema((v) => v.object({ name: v.string() }))();
      const replacementSchema = defineSchema((v) => v.object({ name: v.string().min(100) }))();
      const config = {
        body: bodySchema,
        limits: { maxBodySize: 64 },
      };
      let originalInvoked = false;
      const configuredHandler = (_request: Request, validated: { body?: { name: string } }) => {
        originalInvoked = true;
        return new Response(validated.body?.name);
      };
      const handler = createValidatedHandler(config, configuredHandler);

      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const request = streamingRequest(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
        { "content-type": "application/json" },
      );
      const responsePromise = handler(request);

      config.body = replacementSchema;
      config.limits.maxBodySize = 0;
      Object.defineProperty(bodySchema, "safeParse", {
        configurable: true,
        value: () => ({ success: false, issues: [] }),
      });
      controller?.enqueue(new TextEncoder().encode('{"name":"Alice"}'));
      controller?.close();

      const response = await responsePromise;

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "Alice");
      assertEquals(originalInvoked, true);
    });

    it("should reject unknown, inherited, accessor-backed, and malformed config", () => {
      let configGetterCalls = 0;
      const accessorConfig = {} as Record<string, unknown>;
      Object.defineProperty(accessorConfig, "body", {
        enumerable: true,
        get() {
          configGetterCalls++;
          return undefined;
        },
      });

      assertThrows(
        () => createValidatedHandler({ unsupported: true } as never, () => new Response()),
        TypeError,
        "unsupported option",
      );
      assertThrows(
        () =>
          createValidatedHandler(
            Object.create({ limits: {} }),
            () => new Response(),
          ),
        TypeError,
        "plain object",
      );
      assertThrows(
        () => createValidatedHandler(accessorConfig as never, () => new Response()),
        TypeError,
        "own data property",
      );
      assertThrows(
        () => createValidatedHandler(null as never, () => new Response()),
        TypeError,
        "plain object",
      );
      assertThrows(
        () => createValidatedHandler({}, null as never),
        TypeError,
        "must be a function",
      );
      assertEquals(configGetterCalls, 0);
    });

    it("should reject accessor-backed schemas without invoking them", () => {
      let schemaGetterCalls = 0;
      const accessorSchema = {} as Record<string, unknown>;
      Object.defineProperty(accessorSchema, "safeParse", {
        enumerable: true,
        get() {
          schemaGetterCalls++;
          return () => ({ success: true, data: undefined });
        },
      });

      assertThrows(
        () =>
          createValidatedHandler(
            { body: accessorSchema as never },
            () => new Response(),
          ),
        TypeError,
        "must be a data property",
      );
      assertStrictEquals(schemaGetterCalls, 0);
    });

    it("should work with no schemas configured", async () => {
      const handler = createValidatedHandler({}, (_req, validated) =>
        new Response(
          JSON.stringify({
            hasBody: validated.body !== undefined,
            hasQuery: validated.query !== undefined,
          }),
          { headers: { "Content-Type": "application/json" } },
        ));

      const req = new Request("http://localhost/api/test");
      const res = await handler(req);
      const data = await res.json();

      assertEquals(res.status, 200);
      assertEquals(data.hasBody, false);
      assertEquals(data.hasQuery, false);
    });
  });
});
