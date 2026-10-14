import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
// @deno-types="../vendor/purgecss-memory.d.ts"
import { PurgeCSS } from "purgecss";
import fixtures from "./memory-source.fixtures.json" with { type: "json" };

describe("in-memory PurgeCSS source distribution", () => {
  for (const [index, fixture] of fixtures.entries()) {
    it("matches pinned upstream raw-CSS result " + (index + 1), async () => {
      const actual = await new PurgeCSS().purge(fixture.options);
      assertEquals(
        actual.map(({ file, ...result }) => {
          assertEquals(file, undefined);
          return result;
        }),
        fixture.expected,
      );
    });
  }
  for (
    const options of [
      "purgecss.config.js",
      { content: [], css: ["input.css"] },
      { content: ["input.html"], css: [{ raw: ".keep{}" }] },
    ]
  ) {
    it(
      "rejects file/config inputs before any filesystem operation " + JSON.stringify(options),
      async () => {
        await assertRejects(
          async () => await Reflect.apply(PurgeCSS.prototype.purge, new PurgeCSS(), [options]),
          TypeError,
          "unsupported",
        );
      },
    );
  }
});
