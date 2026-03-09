import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bundleHttpImports, hasHttpImports } from "./http-bundler.ts";

describe("transforms/esm/http-bundler", () => {
  describe("hasHttpImports", () => {
    it("returns true for code with https import", () => {
      assertEquals(hasHttpImports(`import React from "https://esm.sh/react@18";`), true);
    });

    it("returns true for code with http import", () => {
      assertEquals(hasHttpImports(`import lib from "http://cdn.com/lib.js";`), true);
    });

    it("returns true for single-quoted https import", () => {
      assertEquals(hasHttpImports(`import React from 'https://esm.sh/react@18';`), true);
    });

    it("returns false for code with no http imports", () => {
      assertEquals(hasHttpImports(`import React from "react";`), false);
    });

    it("returns false for empty string", () => {
      assertEquals(hasHttpImports(""), false);
    });

    it("returns false for http URL not in quotes", () => {
      assertEquals(hasHttpImports("// https://esm.sh/react"), false);
    });

    it("returns true for dynamic import with http URL", () => {
      assertEquals(hasHttpImports(`const m = import("https://esm.sh/react");`), true);
    });
  });

  describe("bundleHttpImports", () => {
    it("returns code unchanged when no http imports exist", () => {
      const code = `import React from "react";`;
      const result = bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result, code);
    });

    it("adds external and target to esm.sh URLs", async () => {
      const code = `import lib from "https://esm.sh/lodash@4";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(typeof result, "string");
      assertEquals(result.includes("external=react"), true);
      assertEquals(result.includes("target=es2022"), true);
    });

    it("skips _vf_modules paths", async () => {
      const code = `import x from "https://esm.sh/react@18";\nimport y from "/_vf_modules/lib.js";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("/_vf_modules/lib.js"), true);
    });

    it("skips _veryfront paths", async () => {
      const code =
        `import x from "https://esm.sh/react@18";\nimport y from "/_veryfront/runtime.js";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("/_veryfront/runtime.js"), true);
    });

    it("does not add external to React package URLs", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("external=react,react-dom"), false);
    });

    it("adds target to esm.sh React URLs without target", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("target=es2022"), true);
    });

    it("converts relative esm.sh paths to full URLs", async () => {
      const code =
        `import lib from "https://esm.sh/lodash@4";\nimport chunk from "/lodash@4/chunk";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("https://esm.sh/lodash@4/chunk"), true);
    });

    it("handles esm.veryfront.com URLs the same as esm.sh", async () => {
      const code = `import lib from "https://esm.veryfront.com/lodash@4";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("external=react"), true);
    });

    it("does not modify non-esm.sh http URLs", async () => {
      const code = `import lib from "https://cdn.example.com/lib.js";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("https://cdn.example.com/lib.js"), true);
    });

    it("uses custom react version for deps param", async () => {
      const code = `import lib from "https://esm.sh/lodash@4";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123", "19.0.0");
      assertEquals(result.includes("react@19.0.0"), true);
    });
  });
});
