import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { processWithLightningCSS } from "./lightning-processor.ts";

describe("build/asset-pipeline/tailwind-processor/lightning-processor", () => {
  it("rejects uncompiled Tailwind imports", async () => {
    for (const css of ['@import "tailwindcss";', "@import 'tailwindcss';"]) {
      await assertRejects(
        () => processWithLightningCSS(css, { filename: "test.css" }),
        TypeError,
        "Compile Tailwind imports",
      );
    }
  });

  it("processes already compiled CSS", async () => {
    const result = await processWithLightningCSS(
      ".container { display: flex; padding: 1rem; }",
      { filename: "test.css", minify: true },
    );
    assertEquals(result, ".container{padding:1rem;display:flex}");
  });

  it("preserves empty input", async () => {
    assertEquals(
      await processWithLightningCSS("", { filename: "test.css", minify: false }),
      "",
    );
  });

  it("accepts explicit browser targets", async () => {
    const result = await processWithLightningCSS(".grid { display: grid; }", {
      filename: "test.css",
      minify: false,
      browserslist: { chrome: 100 },
    });
    assertEquals(result.includes("grid"), true);
  });

  it("rejects unsupported browser queries", async () => {
    await assertRejects(
      () =>
        processWithLightningCSS(".grid { display: grid; }", {
          filename: "test.css",
          browserslist: ["defaults"],
        }),
      TypeError,
      "Unsupported browser target",
    );
  });

  it("rejects source maps because the string return type cannot represent them", async () => {
    await assertRejects(
      () =>
        processWithLightningCSS(".grid { display: grid; }", {
          filename: "test.css",
          sourceMap: true,
        }),
      TypeError,
      "cannot return source maps",
    );
  });
});
