import "#veryfront/schemas/_test-setup.ts";
/**
 * createRoute wrapper tests
 */

import {
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRoute, defineSchema } from "./create-route.ts";
import { OPENAPI_METADATA, type OpenAPIRouteMetadata } from "./types.ts";

function getMetadata(handler: unknown): OpenAPIRouteMetadata {
  const metadata = (handler as Record<string | symbol, unknown>)[OPENAPI_METADATA];
  assertExists(metadata);
  return metadata as OpenAPIRouteMetadata;
}

describe("createRoute", () => {
  it("should attach metadata to handler", () => {
    const handler = createRoute({
      summary: "Get user",
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertEquals(metadata.summary, "Get user");
  });

  it("should convert params schema to JSON Schema", () => {
    const handler = createRoute({
      params: defineSchema((v) =>
        v.object({
          id: v.string().uuid(),
        })
      )(),
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.params);
    assertEquals(metadata.params.type, "object");
    assertExists(metadata.params.properties?.id);
  });

  it("should convert query schema to JSON Schema", () => {
    const handler = createRoute({
      query: defineSchema((v) =>
        v.object({
          page: v.coerce.number().optional(),
          limit: v.coerce.number().default(10),
        })
      )(),
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.query);
    assertEquals(metadata.query.type, "object");
    assertExists(metadata.query.properties?.page);
    assertExists(metadata.query.properties?.limit);
  });

  it("should convert body schema to JSON Schema", () => {
    const handler = createRoute({
      body: defineSchema((v) =>
        v.object({
          name: v.string(),
          email: v.string().email(),
        })
      )(),
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.body);
    assertEquals(metadata.body.type, "object");
    assertExists(metadata.body.properties?.name);
    assertExists(metadata.body.properties?.email);
  });

  it("should handle response with schema only", () => {
    const handler = createRoute({
      response: {
        200: defineSchema((v) => v.object({ id: v.string() }))(),
      },
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.responses);
    assertExists(metadata.responses["200"]);
    assertEquals(metadata.responses["200"].description, "Successful response");
  });

  it("should handle response with schema and description", () => {
    const handler = createRoute({
      response: {
        200: {
          schema: defineSchema((v) => v.object({ id: v.string() }))(),
          description: "User found",
        },
        404: {
          schema: defineSchema((v) => v.object({ error: v.string() }))(),
          description: "User not found",
        },
      },
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.responses);
    assertExists(metadata.responses["200"]);
    assertExists(metadata.responses["404"]);
    assertEquals(metadata.responses["200"]!.description, "User found");
    assertEquals(metadata.responses["404"]!.description, "User not found");
  });

  it("should preserve tags and deprecated flag", () => {
    const handler = createRoute({
      tags: ["Users", "Admin"],
      deprecated: true,
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertEquals(metadata.tags, ["Users", "Admin"]);
    assertEquals(metadata.deprecated, true);
  });

  it("should return callable handler", async () => {
    const handler = createRoute({
      handler: () => new Response("success"),
    });

    const mockContext = {
      params: {},
      searchParams: new URLSearchParams(),
    };
    const response = await handler(new Request("http://test.com"), mockContext);
    assertEquals(await response.text(), "success");
  });

  it("preserves the common handler identity while capturing immutable metadata", () => {
    const tags = ["Users"];
    const original = () => new Response("ok");
    const handler = createRoute({
      summary: "Original",
      tags,
      handler: original,
    });
    tags[0] = "Mutated";

    assertStrictEquals(handler, original);
    assertEquals(getMetadata(handler).tags, ["Users"]);
    assertEquals(Object.isFrozen(getMetadata(handler)), true);
    assertEquals(Object.isFrozen(getMetadata(handler).tags), true);
  });

  it("wraps frozen and reused handlers without overwriting earlier metadata", async () => {
    const original = Object.freeze(() => new Response("ok"));
    const first = createRoute({ summary: "First", handler: original });
    const second = createRoute({ summary: "Second", handler: original });

    assertNotStrictEquals(first, original);
    assertNotStrictEquals(second, original);
    assertNotStrictEquals(first, second);
    assertEquals(getMetadata(first).summary, "First");
    assertEquals(getMetadata(second).summary, "Second");
    assertEquals(
      await (await first(new Request("https://example.test"), { params: {} })).text(),
      "ok",
    );
  });

  it("fails closed when a declared schema cannot be represented", () => {
    assertThrows(
      () =>
        createRoute({
          params: {} as never,
          handler: () => new Response("ok"),
        }),
      TypeError,
      "params schema",
    );
  });

  it("rejects accessor-backed configuration without invoking it", () => {
    let reads = 0;
    const config = Object.defineProperty(
      { handler: () => new Response("ok") },
      "summary",
      {
        enumerable: true,
        get() {
          reads++;
          return "unsafe";
        },
      },
    );

    assertThrows(
      () => createRoute(config),
      TypeError,
      "data properties",
    );
    assertEquals(reads, 0);
  });
});
