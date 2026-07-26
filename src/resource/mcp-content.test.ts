import "#veryfront/schemas/_test-setup.ts";
import { assertLessOrEqual, assertThrows } from "#veryfront/testing/assert.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { resource } from "./factory.ts";
import { ResourceContentValidationError, toMCPResourceContents } from "./mcp-content.ts";

const MAX_RESOURCE_CONTENT_BYTES = 4 * 1024 * 1024;

Deno.test("MCP JSON serialization stays within the validated transport bound", () => {
  const definition = resource({
    pattern: "test://bounded-json",
    description: "Bounded JSON",
    paramsSchema: defineSchema((v) => v.object({}))(),
    load: () => ({}),
  });
  const data: Record<string, number> = {};
  for (let index = 0; index < 90_000; index++) {
    data[String(index).padStart(38, "k")] = 0;
  }

  const contents = toMCPResourceContents(
    definition.id,
    definition,
    data,
    definition.pattern,
  );
  if (!("text" in contents)) {
    throw new Error("Expected JSON resource text");
  }

  assertLessOrEqual(
    new TextEncoder().encode(contents.text).byteLength,
    MAX_RESOURCE_CONTENT_BYTES,
  );
});

Deno.test("MCP text and blob bounds are measured in transport bytes", () => {
  const emptyParams = defineSchema((v) => v.object({}))();
  const text = resource({
    pattern: "test://bounded-text",
    description: "Bounded text",
    paramsSchema: emptyParams,
    mcp: { content: { type: "text", mimeType: "text/plain" } },
    load: () => "",
  });
  const blob = resource({
    pattern: "test://bounded-blob",
    description: "Bounded blob",
    paramsSchema: emptyParams,
    mcp: { content: { type: "blob", mimeType: "application/octet-stream" } },
    load: () => new Uint8Array(),
  });

  assertThrows(
    () =>
      toMCPResourceContents(
        text.id,
        text,
        "é".repeat(2_100_000),
        text.pattern,
      ),
    ResourceContentValidationError,
  );
  assertThrows(
    () =>
      toMCPResourceContents(
        blob.id,
        blob,
        new Uint8Array(MAX_RESOURCE_CONTENT_BYTES + 1),
        blob.pattern,
      ),
    ResourceContentValidationError,
  );
});
