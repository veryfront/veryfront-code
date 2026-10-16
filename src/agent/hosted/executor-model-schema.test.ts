import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { getExecutorModelOptionsSchema } from "./executor-model-schema.ts";

Deno.test("provider tool IDs require an interior dot and reject line terminators", () => {
  const schema = getExecutorModelOptionsSchema();
  for (const id of ["openai.web_search", "a..", "..b"]) {
    assert(
      schema.safeParse({ prompt: [], tools: [{ type: "provider", name: "search", id, args: {} }] })
        .success,
    );
  }
  for (const id of ["", ".", "a.", ".b", "missing", "a.b\n", "a.b\r", "a.b\u2028", "a.b\u2029"]) {
    assertEquals(
      schema.safeParse({ prompt: [], tools: [{ type: "provider", name: "search", id, args: {} }] })
        .success,
      false,
      id,
    );
  }
});

Deno.test("provider tool IDs with many dots fail promptly on a line terminator", () => {
  const schema = getExecutorModelOptionsSchema();
  const id = ".".repeat(150_000) + "\ninvalid";
  const start = performance.now();
  assertEquals(
    schema.safeParse({ prompt: [], tools: [{ type: "provider", name: "search", id, args: {} }] })
      .success,
    false,
  );
  assert(
    performance.now() - start < 2_000,
    "Malformed provider IDs must complete within two seconds",
  );
});
