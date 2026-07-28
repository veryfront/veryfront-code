import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CrossProjectSourceTooLargeError,
  readLimitedCrossProjectSource,
} from "./cross-project-source-limit.ts";

describe("modules/server/cross-project-source-limit", () => {
  it("enforces UTF-8 bytes rather than string code units", async () => {
    await assertRejects(
      () =>
        readLimitedCrossProjectSource(
          new Response("éé"),
          "https://registry.example/module.ts",
          3,
        ),
      CrossProjectSourceTooLargeError,
      "3 bytes",
    );
  });

  it("accepts a body exactly at the configured boundary", async () => {
    const source = await readLimitedCrossProjectSource(
      new Response("éé"),
      "https://registry.example/module.ts",
      4,
    );
    assertEquals(source, "éé");
  });

  it("rejects invalid limits before consuming the response", async () => {
    for (const maxBytes of [0, -1, 1.5, Number.NaN]) {
      await assertRejects(
        () =>
          readLimitedCrossProjectSource(
            new Response("source"),
            "https://registry.example/module.ts",
            maxBytes,
          ),
        RangeError,
        "maxBytes",
      );
    }
  });

  it("rejects malformed UTF-8 source bodies", async () => {
    await assertRejects(
      () =>
        readLimitedCrossProjectSource(
          new Response(new Uint8Array([0xc3, 0x28])),
          "https://registry.example/module.ts",
          10,
        ),
      TypeError,
    );
  });
});
