import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
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

describe("security/input-validation/handler", () => {
  describe("createValidatedHandler", () => {
    it("should validate body and pass to handler", async () => {
      const bodySchema = z.object({ name: z.string() });

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
      const querySchema = z.object({ page: z.string() });

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
      const bodySchema = z.object({ name: z.string() });
      const querySchema = z.object({ format: z.string() });

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
      const bodySchema = z.object({ name: z.string() });

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
      const querySchema = z.object({ page: z.string().min(1) });

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
      const bodySchema = z.object({ name: z.string() });

      const handler = createValidatedHandler(
        { body: bodySchema },
        () => new Response("OK"),
      );

      const req = jsonRequest("http://localhost/api/test", { name: 123 });
      const res = await handler(req);

      assertEquals(res.headers.get("Content-Type"), "application/json");
    });

    it("should include error details in response", async () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

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

      const handler = createValidatedHandler({}, (req) => {
        receivedUrl = req.url;
        return new Response("OK");
      });

      const req = new Request("http://localhost/api/test");
      await handler(req);

      assertEquals(receivedUrl, "http://localhost/api/test");
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
      const bodySchema = z.object({ data: z.string() });

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
