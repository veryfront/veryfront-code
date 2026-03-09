import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isCrossProjectImport,
  parseCrossProjectImport,
  resolvePathAliases,
  resolveRelativeImports,
} from "./path-resolver.ts";

describe("transforms/esm/path-resolver", () => {
  describe("isCrossProjectImport", () => {
    it("should detect versioned cross-project imports", () => {
      assertEquals(isCrossProjectImport("demo@1.0/@/components/Button"), true);
    });

    it("should detect latest cross-project imports", () => {
      assertEquals(isCrossProjectImport("demo/@/components/Button"), true);
    });

    it("should reject regular imports", () => {
      for (const specifier of ["react", "./local", "@/alias"]) {
        assertEquals(isCrossProjectImport(specifier), false);
      }
    });

    it("should detect semver-range cross-project imports", () => {
      assertEquals(isCrossProjectImport("my-lib@^2.0.0/@/utils"), true);
    });

    it("should detect x-range versions", () => {
      assertEquals(isCrossProjectImport("pkg@1.x/@/mod"), true);
    });
  });

  describe("parseCrossProjectImport", () => {
    it("should parse versioned import", () => {
      const result = parseCrossProjectImport("demo@1.0/@/components/Button");
      assertEquals(result?.projectSlug, "demo");
      assertEquals(result?.version, "1.0");
      assertEquals(result?.path, "components/Button");
    });

    it("should parse latest import", () => {
      const result = parseCrossProjectImport("demo/@/components/Button");
      assertEquals(result?.projectSlug, "demo");
      assertEquals(result?.version, "latest");
      assertEquals(result?.path, "components/Button");
    });

    it("should return null for non-cross-project specifiers", () => {
      for (const specifier of ["react", "./local", "@/alias"]) {
        assertEquals(parseCrossProjectImport(specifier), null);
      }
    });

    it("should handle nested paths", () => {
      const result = parseCrossProjectImport("my-lib@2.0.0/@/deep/nested/path");
      assertEquals(result?.projectSlug, "my-lib");
      assertEquals(result?.version, "2.0.0");
      assertEquals(result?.path, "deep/nested/path");
    });

    it("should handle caret version ranges", () => {
      const result = parseCrossProjectImport("pkg@^1.0.0/@/utils");
      assertEquals(result?.projectSlug, "pkg");
      assertEquals(result?.version, "^1.0.0");
      assertEquals(result?.path, "utils");
    });
  });

  describe("resolvePathAliases", () => {
    it("replaces @/ alias with relative path for root-level file", async () => {
      const code = `import { Button } from "@/components/Button";`;
      const result = await resolvePathAliases(code, "/project/index.tsx", "/project");
      assertEquals(result.includes("./components/Button"), true);
    });

    it("replaces @/ alias with relative path for nested file", async () => {
      const code = `import { utils } from "@/lib/utils";`;
      const result = await resolvePathAliases(code, "/project/pages/home.tsx", "/project");
      assertEquals(result.includes("../lib/utils"), true);
    });

    it("appends .js extension when specifier has no extension", async () => {
      const code = `import { foo } from "@/lib/foo";`;
      const result = await resolvePathAliases(code, "/project/index.tsx", "/project");
      assertEquals(result.includes(".js"), true);
    });

    it("does not modify non-alias imports", async () => {
      const code = `import React from "react";`;
      const result = await resolvePathAliases(code, "/project/index.tsx", "/project");
      assertEquals(result, code);
    });

    it("does not modify relative imports", async () => {
      const code = `import { foo } from "./foo";`;
      const result = await resolvePathAliases(code, "/project/index.tsx", "/project");
      assertEquals(result, code);
    });

    it("handles SSR mode replacing extensions with .js", async () => {
      const code = `import { Button } from "@/components/Button.tsx";`;
      const result = await resolvePathAliases(code, "/project/index.tsx", "/project", true);
      assertEquals(result.includes(".js"), true);
      assertEquals(result.includes(".tsx"), false);
    });

    it("handles deeply nested files", async () => {
      const code = `import { utils } from "@/utils";`;
      const result = await resolvePathAliases(
        code,
        "/project/src/pages/about/index.tsx",
        "/project",
      );
      assertEquals(result.includes("../../../utils"), true);
    });
  });

  describe("resolveRelativeImports", () => {
    it("rewrites .tsx extensions to .js", async () => {
      const code = `import { foo } from "./foo.tsx";`;
      const result = await resolveRelativeImports(code, "/project/index.tsx", "/project");
      assertEquals(result.includes("./foo.js"), true);
    });

    it("rewrites .ts extensions to .js", async () => {
      const code = `import { foo } from "./foo.ts";`;
      const result = await resolveRelativeImports(code, "/project/index.tsx", "/project");
      assertEquals(result.includes("./foo.js"), true);
    });

    it("rewrites .jsx extensions to .js", async () => {
      const code = `import { foo } from "./foo.jsx";`;
      const result = await resolveRelativeImports(code, "/project/index.tsx", "/project");
      assertEquals(result.includes("./foo.js"), true);
    });

    it("does not modify non-relative imports", async () => {
      const code = `import React from "react";`;
      const result = await resolveRelativeImports(code, "/project/index.tsx", "/project");
      assertEquals(result, code);
    });

    it("does not modify .js extensions", async () => {
      const code = `import { foo } from "./foo.js";`;
      const result = await resolveRelativeImports(code, "/project/index.tsx", "/project");
      assertEquals(result.includes("./foo.js"), true);
    });

    it("prepends module server URL when provided", async () => {
      const code = `import { foo } from "./foo.js";`;
      const result = await resolveRelativeImports(
        code,
        "/project/src/index.tsx",
        "/project",
        "https://modules.example.com",
      );
      assertEquals(result.includes("https://modules.example.com/"), true);
    });

    it("handles parent directory references", async () => {
      const code = `import { bar } from "../lib/bar.tsx";`;
      const result = await resolveRelativeImports(code, "/project/src/index.tsx", "/project");
      assertEquals(result.includes("../lib/bar.js"), true);
    });
  });
});
