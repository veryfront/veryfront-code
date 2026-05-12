import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
      ).properties.confirm.type,
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
});
