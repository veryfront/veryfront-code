import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
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

  it("retains the sanitize option for compatibility", async () => {
    const textSchema = defineSchema((v) => v.object({ value: v.string() }))();
    const result = await parseJsonBody(
      createJsonRequest(JSON.stringify({ value: "<b>&</b>" })),
      textSchema,
      { sanitize: true },
    );

    assertEquals(result, { value: "&lt;b&gt;&amp;&lt;&#x2F;b&gt;" });
  });

  it("rejects a non-boolean sanitize option", async () => {
    await assertRejects(
      () =>
        parseJsonBody(
          createJsonRequest(JSON.stringify({ name: "Alice", age: 30 })),
          schema,
          { sanitize: "yes" } as never,
        ),
      TypeError,
      "sanitize must be a boolean",
    );
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

  it("rejects malformed, overlong, and truncated UTF-8 JSON strings", async () => {
    const encoder = new TextEncoder();
    const prefix = encoder.encode('{"name":"');
    const suffix = encoder.encode('","age":30}');

    for (
      const invalidBytes of [
        new Uint8Array([0xc0, 0xaf]),
        new Uint8Array([0x80]),
        new Uint8Array([0xe2, 0x82]),
      ]
    ) {
      const body = new Uint8Array(prefix.length + invalidBytes.length + suffix.length);
      body.set(prefix);
      body.set(invalidBytes, prefix.length);
      body.set(suffix, prefix.length + invalidBytes.length);
      const request = new Request("http://localhost/test", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      });

      await assertRejects(
        () => parseJsonBody(request, schema),
        VeryfrontError,
        "Invalid JSON",
      );
    }
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

  it("rejects JSON trees beyond the bounded structural depth before schema traversal", async () => {
    const anyJsonSchema = defineSchema((v) => v.unknown())();
    const body = `${"[".repeat(130)}null${"]".repeat(130)}`;

    await assertRejects(
      () => parseJsonBody(createJsonRequest(body), anyJsonSchema),
      VeryfrontError,
      "JSON value exceeds structural limits",
    );
  });

  it("rejects unknown and accessor-backed parser options", async () => {
    let getterCalls = 0;
    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, "limits", {
      enumerable: true,
      get() {
        getterCalls++;
        return {};
      },
    });

    await assertRejects(
      () => parseJsonBody(createJsonRequest("{}"), schema, { unknown: true } as never),
      TypeError,
      "unsupported option",
    );
    await assertRejects(
      () => parseJsonBody(createJsonRequest("{}"), schema, options as never),
      TypeError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
  });
});

describe("parseFormData", () => {
  const schema = defineSchema((v) =>
    v.object({
      name: v.string(),
    })
  )();

  it("parses a bounded URL-encoded form", async () => {
    const request = new Request("http://localhost/form", {
      method: "POST",
      body: "name=Alice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    assertEquals(await parseFormData(request, schema), { name: "Alice" });
  });

  it("bounds a chunked form body before parsing it", async () => {
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("name="));
          controller.enqueue(new TextEncoder().encode("Alice"));
          controller.close();
        },
      }),
      duplex: "half",
    };
    const request = new Request("http://localhost/form", init);

    await assertRejects(
      () => parseFormData(request, schema, { limits: { maxBodySize: 5 } }),
      VeryfrontError,
      "exceeds size limit",
    );
  });

  it("classifies malformed multipart bodies as validation failures", async () => {
    const request = new Request("http://localhost/form", {
      method: "POST",
      body: "not-a-multipart-body",
      headers: { "content-type": "multipart/form-data; boundary=missing" },
    });

    await assertRejects(
      () => parseFormData(request, schema),
      VeryfrontError,
      "Invalid form data",
    );
  });

  it("collects special form field names without changing the input prototype", async () => {
    let captured: Record<string, unknown> | undefined;
    const captureSchema = {
      safeParse(data: unknown) {
        captured = data as Record<string, unknown>;
        return { success: true as const, data: captured };
      },
    } as unknown as Schema<Record<string, unknown>>;
    const request = new Request("http://localhost/form", {
      method: "POST",
      body: "__proto__=safe",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    await parseFormData(request, captureSchema);

    assertEquals(Object.getPrototypeOf(captured!), null);
    assertEquals(Object.hasOwn(captured!, "__proto__"), true);
    assertEquals(captured!["__proto__"], "safe");
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

  it("treats __proto__ as data without mutating the collector prototype", () => {
    let captured: Record<string, unknown> | undefined;
    const captureSchema = {
      safeParse(data: unknown) {
        captured = data as Record<string, unknown>;
        return { success: true as const, data: captured };
      },
    } as unknown as Schema<Record<string, unknown>>;
    const request = new Request(
      "http://localhost/search?__proto__=first&__proto__=second",
    );

    const result = parseQueryParams(request, captureSchema);

    assertEquals(Object.getPrototypeOf(captured!), null);
    assertEquals(Object.hasOwn(captured!, "__proto__"), true);
    assertEquals(result["__proto__"], ["first", "second"]);
  });

  it("enforces UTF-8 URL limits for standalone query parsing", () => {
    const request = new Request(`http://localhost/search?q=${"å".repeat(32)}`);

    assertThrows(
      () => parseQueryParams(request, schema, { limits: { maxUrlLength: 32 } }),
      VeryfrontError,
      "URL too long",
    );
  });

  it("rejects unknown and accessor-backed query parser options", () => {
    let getterCalls = 0;
    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, "limits", {
      enumerable: true,
      get() {
        getterCalls++;
        return {};
      },
    });

    assertThrows(
      () =>
        parseQueryParams(new Request("http://localhost/search?q=test"), schema, {
          unknown: true,
        } as never),
      TypeError,
      "unsupported option",
    );
    assertThrows(
      () =>
        parseQueryParams(
          new Request("http://localhost/search?q=test"),
          schema,
          options as never,
        ),
      TypeError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
  });
});
