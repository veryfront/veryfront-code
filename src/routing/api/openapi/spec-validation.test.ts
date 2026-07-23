import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateOpenAPISpec } from "./spec-validation.ts";

function validSpec() {
  return {
    openapi: "3.1.0" as const,
    info: { title: "Example API", version: "1.0.0" },
    paths: {
      "/api/users": {
        get: {
          summary: "List users",
          responses: { "200": { description: "Successful response" } },
        },
      },
    },
    tags: [],
    servers: [{ url: "https://example.com", description: "Current server" }],
  };
}

describe("OpenAPI worker result validation", () => {
  it("accepts the generated OpenAPI 3.1 shape", () => {
    const spec = validSpec();
    assertEquals(validateOpenAPISpec(spec), spec);
  });

  it("rejects strings that exceed the result bound", () => {
    const spec = validSpec();
    spec.info.title = "x".repeat(1024 * 1024 + 1);

    assertThrows(
      () => validateOpenAPISpec(spec),
      TypeError,
      "bounded string",
    );
  });

  it("rejects unsupported operation fields", () => {
    const spec = validSpec() as unknown as Record<string, unknown>;
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    paths["/api/users"]!.get!.internalSecret = "must-not-cross-boundary";

    assertThrows(
      () => validateOpenAPISpec(spec),
      TypeError,
      "unsupported field",
    );
  });

  it("rejects accessors without executing them in the host", () => {
    const spec = validSpec();
    let getterExecuted = false;
    Object.defineProperty(spec.info, "description", {
      enumerable: true,
      get() {
        getterExecuted = true;
        return "private-getter-canary";
      },
    });

    assertThrows(
      () => validateOpenAPISpec(spec),
      TypeError,
      "accessor properties",
    );
    assertEquals(getterExecuted, false);
  });
});
