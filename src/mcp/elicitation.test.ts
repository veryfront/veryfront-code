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
      (
        request.params.requestedSchema as Record<
          string,
          Record<string, Record<string, unknown>>
        >
      ).properties!.confirm!.type,
      "boolean",
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

  it("snapshots form schemas instead of retaining caller-owned state", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    const request = buildFormElicitation({
      message: "Choose a name",
      schema,
    });
    schema.properties.name.type = "number";

    assertEquals(request.params.requestedSchema, {
      type: "object",
      properties: { name: { type: "string" } },
    });
  });

  it("accepts supported single-select and multi-select enum schemas", () => {
    const request = buildFormElicitation({
      message: "Choose colors",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          primary: {
            type: "string",
            oneOf: [
              { const: "#f00", title: "Red" },
              { const: "#00f", title: "Blue" },
            ],
            default: "#f00",
          },
          accents: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "string",
              enum: ["Red", "Blue"],
            },
            default: ["Red"],
          },
        },
        required: ["primary"],
      },
    });

    assertEquals(
      (request.params.requestedSchema as Record<string, unknown>).type,
      "object",
    );
  });

  it("rejects schemas outside MCP's flat primitive subset", () => {
    for (
      const schema of [
        {
          type: "object",
          properties: {
            nested: {
              type: "object",
              properties: { value: { type: "string" } },
            },
          },
        },
        {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
        {
          type: "object",
          properties: {
            choice: {
              type: "string",
              enum: ["a"],
              default: "b",
            },
          },
        },
        {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["missing"],
        },
      ]
    ) {
      assertThrows(
        () =>
          buildFormElicitation({
            message: "Choose",
            schema,
          }),
        TypeError,
        "schema",
      );
    }
  });

  it("rejects malformed form elicitation input", () => {
    assertThrows(
      () =>
        buildFormElicitation({
          message: "",
          schema: { type: "object" },
        }),
      TypeError,
      "message",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertThrows(
      () =>
        buildFormElicitation({
          message: "Choose",
          schema: cyclic,
        }),
      TypeError,
      "schema",
    );
  });

  it("rejects unsafe URL elicitation input", () => {
    for (const url of ["not a URL", "javascript:alert(1)", "file:///secret"]) {
      assertThrows(
        () =>
          buildUrlElicitation({
            message: "Continue",
            url,
            elicitationId: "elicit-123",
          }),
        TypeError,
        "URL",
      );
    }
    assertThrows(
      () =>
        buildUrlElicitation({
          message: "Continue",
          url: "https://example.com",
          elicitationId: "",
        }),
      TypeError,
      "elicitationId",
    );
  });
});
