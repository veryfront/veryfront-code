import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { transformImportsWithMap } from "./transformer.ts";

describe("modules/import-map/transformer", () => {
  describe("transformImportsWithMap", () => {
    it("should transform esm.sh import specifiers", () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const map = { imports: { react: "https://esm.sh/react@19" } };
      const result = transformImportsWithMap(code, map);
      assertEquals(result.includes("react@19"), true);
    });

    it("should transform dynamic imports", () => {
      const code = `const mod = import("https://esm.sh/lodash@4");`;
      const map = { imports: { lodash: "https://esm.sh/lodash@4.17" } };
      const result = transformImportsWithMap(code, map);
      assertEquals(result.includes("lodash@4.17"), true);
    });

    it("should not transform bare imports by default", () => {
      const code = `import lodash from "lodash";`;
      const map = { imports: { lodash: "https://esm.sh/lodash@4" } };
      const result = transformImportsWithMap(code, map);
      assertEquals(result.includes('"lodash"'), true);
    });

    it("should transform bare imports when resolveBare is true", () => {
      const code = `import lodash from "lodash";`;
      const map = { imports: { lodash: "https://esm.sh/lodash@4" } };
      const result = transformImportsWithMap(code, map, undefined, { resolveBare: true });
      assertEquals(result.includes("esm.sh/lodash"), true);
    });

    it("should transform export from statements", () => {
      const code = `export { useState } from "https://esm.sh/react@18";`;
      const map = { imports: { react: "https://esm.sh/react@19" } };
      const result = transformImportsWithMap(code, map);
      assertEquals(result.includes("react@19"), true);
    });

    it("should leave non-matching specifiers unchanged", () => {
      const code = `import "./local.ts";`;
      const map = { imports: {} };
      assertEquals(transformImportsWithMap(code, map), code);
    });

    it("should use scope when provided", () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const map = {
        imports: { react: "https://esm.sh/react@17" },
        scopes: { "/app/": { react: "https://esm.sh/react@19" } },
      };
      const result = transformImportsWithMap(code, map, "/app/");
      assertEquals(result.includes("react@19"), true);
    });

    it("applies exactly one mapping instead of cascading through the output", () => {
      const code = `import value from "first";`;
      const map = {
        imports: {
          first: "second",
          second: "third",
        },
      };

      assertEquals(
        transformImportsWithMap(code, map, undefined, { resolveBare: true }),
        `import value from "second";`,
      );
    });

    it("does not rewrite import-looking text in strings, comments, or regex literals", () => {
      const code = [
        `const text = 'import value from "first"';`,
        `// import value from "first";`,
        `const pattern = /import value from "first"/;`,
        `import value from "first";`,
      ].join("\n");
      const result = transformImportsWithMap(
        code,
        { imports: { first: "second" } },
        undefined,
        { resolveBare: true },
      );

      assertEquals(
        result,
        [
          `const text = 'import value from "first"';`,
          `// import value from "first";`,
          `const pattern = /import value from "first"/;`,
          `import value from "second";`,
        ].join("\n"),
      );
    });

    it("handles comments inside import declarations without deleting them", () => {
      const code = `import /* retained */ value from "first";`;
      assertEquals(
        transformImportsWithMap(
          code,
          { imports: { first: "second" } },
          undefined,
          { resolveBare: true },
        ),
        `import /* retained */ value from "second";`,
      );
    });

    it("escapes mapped specifiers as JavaScript string literals", () => {
      const code = `const loaded = import("first");`;
      assertEquals(
        transformImportsWithMap(
          code,
          { imports: { first: 'second"line\nvalue' } },
          undefined,
          { resolveBare: true },
        ),
        `const loaded = import("second\\"line\\nvalue");`,
      );
    });
  });
});
