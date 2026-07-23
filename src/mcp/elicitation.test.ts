import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildFormElicitation, buildUrlElicitation } from "./elicitation.ts";

describe("mcp/elicitation", () => {
  it("builds a form mode elicitation request", () => {
    const request = buildFormElicitation({
      message: "Confirm deletion?",
      schema: {
        type: "object",
        properties: {
          confirm: { type: "boolean", title: "Confirm", default: false },
        },
        required: ["confirm"],
      },
    });
    assertEquals(request.method, "elicitation/create");
    assertEquals(request.params.mode, "form");
    assertEquals(request.params.message, "Confirm deletion?");
    assertEquals(
      (request.params.requestedSchema as {
        properties: Record<string, { type: string }>;
      }).properties.confirm!.type,
      "boolean",
    );
  });

  it("preserves the optional JSON Schema dialect declaration", () => {
    const request = buildFormElicitation({
      message: "Confirm?",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { confirm: { type: "boolean" } },
      },
    });

    assertEquals(
      (request.params.requestedSchema as Record<string, unknown>).$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("builds a URL mode elicitation request", () => {
    const request = buildUrlElicitation({
      message: "Please authorize with GitHub",
      url: "https://example.com/auth",
      elicitationId: "elicit-123",
    });
    assertEquals(request.method, "elicitation/create");
    assertEquals(request.params.mode, "url");
    assertEquals(request.params.url, "https://example.com/auth");
    assertEquals(request.params.elicitationId, "elicit-123");
  });

  it("rejects URL elicitations with unsafe or credential-bearing URLs", () => {
    for (
      const url of [
        "javascript:alert(1)",
        "data:text/html,unsafe",
        "https://user:secret@example.com/auth",
        "http://example.com/auth",
        "https://example.com/auth?access_token=secret",
        "https://example.com/auth?access-token=secret",
        "https://example.com/auth#access_token=secret",
      ]
    ) {
      assertThrows(
        () =>
          buildUrlElicitation({
            message: "Authorize",
            url,
            elicitationId: "elicit-123",
          }),
        TypeError,
        "elicitation URL",
      );
    }
  });

  it("rejects malformed identifiers and empty messages", () => {
    assertThrows(
      () =>
        buildUrlElicitation({
          message: " ",
          url: "https://example.com/auth",
          elicitationId: "elicit-123",
        }),
      TypeError,
      "message",
    );
    assertThrows(
      () =>
        buildUrlElicitation({
          message: "Authorize",
          url: "https://example.com/auth",
          elicitationId: "bad\nid",
        }),
      TypeError,
      "elicitation ID",
    );
  });

  it("snapshots form schemas so callers cannot mutate emitted requests", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: { confirm: { type: "boolean" } },
    };
    const request = buildFormElicitation({ message: "Confirm?", schema });
    (schema.properties as Record<string, unknown>).confirm = { type: "string" };

    assertEquals(
      (request.params.requestedSchema as {
        properties: Record<string, { type: string }>;
      }).properties.confirm!.type,
      "boolean",
    );
  });

  it("rejects nested form schemas outside the MCP elicitation subset", () => {
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: {
              nested: {
                type: "object",
                properties: { value: { type: "string" } },
              },
            },
          },
        }),
      TypeError,
      "schema",
    );
  });

  it("supports the MCP multi-select enum schema subset", () => {
    const request = buildFormElicitation({
      message: "Choose colors",
      schema: {
        type: "object",
        properties: {
          colors: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              anyOf: [
                { const: "#f00", title: "Red" },
                { const: "#00f", title: "Blue" },
              ],
            },
            default: ["#f00"],
          },
        },
      },
    });

    assertEquals(
      (request.params.requestedSchema as {
        properties: Record<string, { type: string }>;
      }).properties.colors!.type,
      "array",
    );
  });

  it("supports the legacy titled enum shape in the current MCP revision", () => {
    const request = buildFormElicitation({
      message: "Choose a color",
      schema: {
        type: "object",
        properties: {
          color: {
            type: "string",
            enum: ["red", "blue"],
            enumNames: ["Red", "Blue"],
            default: "red",
          },
        },
      },
    });

    assertEquals(
      (request.params.requestedSchema as {
        properties: Record<string, { enumNames: string[] }>;
      }).properties.color!.enumNames,
      ["Red", "Blue"],
    );
  });

  it("preserves valid string patterns and rejects invalid expressions", () => {
    const request = buildFormElicitation({
      message: "Enter a name",
      schema: {
        type: "object",
        properties: { name: { type: "string", pattern: "^[A-Za-z]+$" } },
      },
    });
    assertEquals(
      (request.params.requestedSchema as {
        properties: Record<string, { pattern: string }>;
      }).properties.name!.pattern,
      "^[A-Za-z]+$",
    );

    assertThrows(
      () =>
        buildFormElicitation({
          message: "Enter a name",
          schema: {
            type: "object",
            properties: { name: { type: "string", pattern: "[" } },
          },
        }),
      TypeError,
      "valid regular expression",
    );
  });

  it("rejects unsupported schema keywords and inconsistent defaults", () => {
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: {
              choice: {
                type: "string",
                enum: ["a", "b"],
                default: "c",
              },
            },
          },
        }),
      TypeError,
      "default",
    );
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: { choice: { type: "string" } },
            additionalProperties: false,
          },
        }),
      TypeError,
      "unsupported",
    );
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: {
              count: { type: "integer", minimum: 1, maximum: 3, default: 4 },
            },
          },
        }),
      TypeError,
      "range constraints",
    );
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: {
              choices: {
                type: "array",
                minItems: 2,
                items: { type: "string", enum: ["a", "b"] },
                default: ["a"],
              },
            },
          },
        }),
      TypeError,
      "item-count constraints",
    );
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: {
              choice: { type: "string", enum: ["a", "b"], minLength: 1 },
            },
          },
        }),
      TypeError,
      "unsupported",
    );
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: {
            type: "object",
            properties: {
              choices: {
                type: "array",
                minItems: 3,
                items: { type: "string", enum: ["a", "b"] },
              },
            },
          },
        }),
      TypeError,
      "available choices",
    );
  });

  it("requires required entries to name own schema properties", () => {
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Confirm?",
          schema: {
            type: "object",
            properties: {},
            required: ["toString"],
          },
        }),
      TypeError,
      "required list",
    );
  });

  it("preserves forward-compatible JSON Schema dialect declarations", () => {
    const request = buildFormElicitation({
      message: "Confirm?",
      schema: {
        $schema: "https://example.com/custom-schema",
        type: "object",
        properties: { confirm: { type: "boolean" } },
      },
    });

    assertEquals(
      (request.params.requestedSchema as Record<string, unknown>).$schema,
      "https://example.com/custom-schema",
    );
  });

  it("rejects malformed builder options at the public boundary", () => {
    assertThrows(
      () => buildFormElicitation(null as never),
      TypeError,
      "options",
    );
    assertThrows(
      () => buildUrlElicitation([] as never),
      TypeError,
      "options",
    );
  });
});
