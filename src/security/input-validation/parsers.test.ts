import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
import { ValidationError } from "./errors.ts";
import { parseJsonBody, parseQueryParams } from "./parsers.ts";

describe("parseJsonBody", () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

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

  it("should throw ValidationError for invalid JSON", async () => {
    const request = createJsonRequest("not json");

    await assertRejects(
      () => parseJsonBody(request, schema),
      ValidationError,
      "Invalid JSON",
    );
  });

  it("should throw ValidationError for schema mismatch", async () => {
    const request = createJsonRequest(
      JSON.stringify({ name: "Alice", age: "not-a-number" }),
    );

    await assertRejects(
      () => parseJsonBody(request, schema),
      ValidationError,
      "Validation failed",
    );
  });

  it("should throw ValidationError for missing required fields", async () => {
    const request = createJsonRequest(JSON.stringify({ name: "Alice" }));

    await assertRejects(
      () => parseJsonBody(request, schema),
      ValidationError,
      "Validation failed",
    );
  });
});

describe("parseQueryParams", () => {
  const schema = z.object({
    page: z.string().optional(),
    q: z.string(),
  });

  it("should parse valid query params", () => {
    const request = new Request("http://localhost/search?q=test&page=2");
    const result = parseQueryParams(request, schema);
    assertEquals(result, { q: "test", page: "2" });
  });

  it("should throw ValidationError for missing required params", () => {
    const request = new Request("http://localhost/search?page=2");

    assertThrows(
      () => parseQueryParams(request, schema),
      ValidationError,
      "Query parameter validation failed",
    );
  });

  it("should handle repeated query params as arrays", () => {
    const arraySchema = z.object({
      tags: z.union([z.string(), z.array(z.string())]),
    });
    const request = new Request("http://localhost/search?tags=a&tags=b&tags=c");
    const result = parseQueryParams(request, arraySchema);
    assertEquals(result, { tags: ["a", "b", "c"] });
  });

  it("should handle single query param as string (not array)", () => {
    const simpleSchema = z.object({
      name: z.string(),
    });
    const request = new Request("http://localhost/search?name=alice");
    const result = parseQueryParams(request, simpleSchema);
    assertEquals(result, { name: "alice" });
  });
});
