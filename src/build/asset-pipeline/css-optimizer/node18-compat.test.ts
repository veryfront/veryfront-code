import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("CSS optimizer host-method independence", () => {
  it("does not require String.prototype.isWellFormed", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      "isWellFormed",
    );
    Object.defineProperty(String.prototype, "isWellFormed", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const pathValidation = await import("./path-validation.ts?without-host-is-well-formed");
      const optimization = await import("./optimization-engine.ts?without-host-is-well-formed");
      const purging = await import("./purging-engine.ts?without-host-is-well-formed");

      assertEquals(pathValidation.isSafeCSSRelativePath("styles/app.css"), true);
      optimization.validateCSSSourceMap(
        JSON.stringify({
          version: 3,
          sources: ["styles/app.css"],
          names: [],
          mappings: "AAAA",
        }),
        "styles/app.css",
      );
      const session = purging.createCSSPurgingSession({
        cacheIdentity: "host-independent-purge@1",
        async purge(request) {
          return { css: request.css };
        },
      });
      const result = await session.run({
        css: ".kept { color: green; }",
        content: [{ raw: '<div class="kept"></div>', extension: "html" }],
        safelist: ["kept"],
        includeRejectedCSS: false,
      });
      assertEquals(result.css, ".kept { color: green; }");
    } finally {
      if (descriptor === undefined) {
        delete (String.prototype as { isWellFormed?: unknown }).isWellFormed;
      } else {
        Object.defineProperty(String.prototype, "isWellFormed", descriptor);
      }
    }
  });
});
