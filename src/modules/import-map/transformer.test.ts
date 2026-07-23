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

    it("rewrites module specifiers without mutating comments or ordinary strings", () => {
      const code = [
        `// import ignored from "https://esm.sh/react@18";`,
        `const description = 'from "https://esm.sh/react@18"';`,
        `const pattern = /from\\s+["']https:\\/\\/esm\\.sh\\/react@18["']/;`,
        `import React from "https://esm.sh/react@18";`,
      ].join("\n");
      const map = { imports: { react: "https://esm.sh/react@19" } };

      assertEquals(
        transformImportsWithMap(code, map),
        [
          `// import ignored from "https://esm.sh/react@18";`,
          `const description = 'from "https://esm.sh/react@18"';`,
          `const pattern = /from\\s+["']https:\\/\\/esm\\.sh\\/react@18["']/;`,
          `import React from "https://esm.sh/react@19";`,
        ].join("\n"),
      );
    });

    it("rewrites side-effect imports and export-from declarations", () => {
      const code = [
        `import "https://esm.sh/react@18";`,
        `export * from "https://esm.sh/react@18/jsx-runtime";`,
      ].join("\n");
      const map = {
        imports: {
          react: "https://esm.sh/react@19",
          "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
        },
      };

      assertEquals(
        transformImportsWithMap(code, map),
        [
          `import "https://esm.sh/react@19";`,
          `export * from "https://esm.sh/react@19/jsx-runtime";`,
        ].join("\n"),
      );
    });

    it("rewrites dynamic imports inside template expressions only", () => {
      const code = [
        'const raw = `import(\\"https://esm.sh/react@18\\")`;',
        'const loaded = `${await import("https://esm.sh/react@18")}`;',
      ].join("\n");
      const map = { imports: { react: "https://esm.sh/react@19" } };

      assertEquals(
        transformImportsWithMap(code, map),
        [
          'const raw = `import(\\"https://esm.sh/react@18\\")`;',
          'const loaded = `${await import("https://esm.sh/react@19")}`;',
        ].join("\n"),
      );
    });

    it("does not rewrite methods named import", () => {
      const code = `loader.import("https://esm.sh/react@18");`;
      const map = { imports: { react: "https://esm.sh/react@19" } };
      assertEquals(transformImportsWithMap(code, map), code);
    });
  });
});
