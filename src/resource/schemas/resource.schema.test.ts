import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { getMcpConfigSchema } from "./resource.schema.ts";

Deno.test("resource MCP schema rejects malformed media types", () => {
  const schema = getMcpConfigSchema();

  for (
    const mimeType of [
      "not-a-media-type",
      "text/plain;\r\ncharset=utf-8",
      `text/${"x".repeat(256)}`,
    ]
  ) {
    assertThrows(() =>
      schema.parse({
        content: { type: "text", mimeType },
      })
    );
  }
});
