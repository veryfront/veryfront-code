import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { VeryfrontError } from "./errors.ts";
import { parseFormData, parseJsonBody, parseQueryParams } from "./parsers.ts";

describe("parseJsonBody", () => {
  const schema = defineSchema((v) =>
    v.object({
      name: v.string(),
      age: v.number(),
    })
  )();

  function createJsonRequest(body: string): Request {
    return new Request("http://localhost/test", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
  }

  it("should parse valid JSON body", async () => {
    const request = createJsonRequest(JSON.stringify({ name: "Alice", age: 30 }));

    const result = await parseJsonBody(request, schema);
    assertEquals(result, { name: "Alice", age: 30 });
  });

  it("should reject request with wrong Content-Type", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ name: "Alice", age: 30 }),
      headers: { "content-type": "text/plain" },
    });

    await assertRejects(
      () => parseJsonBody(request, schema),
      VeryfrontError,
      "Invalid Content-Type",
    );
  });

  it("should reject request with missing Content-Type", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ name: "Alice", age: 30 }),
    });
    // Deno auto-sets Content-Type to text/plain for string bodies,
    // so delete it to simulate a truly missing header
    request.headers.delete("content-type");

    await assertRejects(
      () => parseJsonBody(request, schema),
      VeryfrontError,
      "Missing Content-Type",
    );
  });

  it("should accept application/json with charset", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ name: "Alice", age: 30 }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    const result = await parseJsonBody(request, schema);
    assertEquals(result, { name: "Alice", age: 30 });
  });

  it("should throw ValidationError for invalid JSON", async () => {
    const request = createJsonRequest("not json");

    await assertRejects(
      () => parseJsonBody(request, schema),
      VeryfrontError,
      "Invalid JSON",
    );
  });

  it("should throw ValidationError for schema mismatch", async () => {
    const request = createJsonRequest(
      JSON.stringify({ name: "Alice", age: "not-a-number" }),
    );

    await assertRejects(
      () => parseJsonBody(request, schema),
      VeryfrontError,
      "Validation failed",
    );
  });

  it("should throw ValidationError for missing required fields", async () => {
    const request = createJsonRequest(JSON.stringify({ name: "Alice" }));

    await assertRejects(
      () => parseJsonBody(request, schema),
      VeryfrontError,
      "Validation failed",
    );
  });
});

describe("parseQueryParams", () => {
  const schema = defineSchema((v) =>
    v.object({
      page: v.string().optional(),
      q: v.string(),
    })
  )();

  it("should parse valid query params", () => {
    const request = new Request("http://localhost/search?q=test&page=2");
    const result = parseQueryParams(request, schema);
    assertEquals(result, { q: "test", page: "2" });
  });

  it("should throw ValidationError for missing required params", () => {
    const request = new Request("http://localhost/search?page=2");

    assertThrows(
      () => parseQueryParams(request, schema),
      VeryfrontError,
      "Query parameter validation failed",
    );
  });

  it("should handle repeated query params as arrays", () => {
    const arraySchema = defineSchema((v) =>
      v.object({
        tags: v.union([v.string(), v.array(v.string())]),
      })
    )();
    const request = new Request("http://localhost/search?tags=a&tags=b&tags=c");
    const result = parseQueryParams(request, arraySchema);
    assertEquals(result, { tags: ["a", "b", "c"] });
  });

  it("should handle single query param as string (not array)", () => {
    const simpleSchema = defineSchema((v) =>
      v.object({
        name: v.string(),
      })
    )();
    const request = new Request("http://localhost/search?name=alice");
    const result = parseQueryParams(request, simpleSchema);
    assertEquals(result, { name: "alice" });
  });
});

describe("parseFormData", () => {
  const schema = defineSchema((v) => v.object({ value: v.string() }))();

  it("should enforce maxBodySize for streamed form bodies without Content-Length", async () => {
    const body = new TextEncoder().encode(`value=${"x".repeat(128)}`);
    const request = new Request("http://localhost/form", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
    });

    await assertRejects(
      () => parseFormData(request, schema, { limits: { maxBodySize: 32 } }),
      VeryfrontError,
      "exceeds size limit",
    );
  });
});
