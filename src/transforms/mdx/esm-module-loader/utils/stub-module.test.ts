import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStubModule, extractNamedImports, generateStubCode } from "./stub-module.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import { getLocalFs } from "../cache/index.ts";

describe("extractNamedImports", () => {
  it("extracts named imports from import statement", () => {
    const code = `import { foo, bar } from "mod";`;
    const result = extractNamedImports(code, `from "mod"`);
    assertEquals(result.includes("foo"), true);
    assertEquals(result.includes("bar"), true);
  });

  it("handles aliased imports (extracts original name)", () => {
    const code = `import { foo as f, bar as b } from "mod";`;
    const result = extractNamedImports(code, `from "mod"`);
    assertEquals(result.includes("foo"), true);
    assertEquals(result.includes("bar"), true);
  });

  it("returns empty for default-only imports", () => {
    const code = `import mod from "mod";`;
    const result = extractNamedImports(code, `from "mod"`);
    assertEquals(result.length, 0);
  });

  it("handles single named import", () => {
    const code = `import { useState } from "react";`;
    const result = extractNamedImports(code, `from "react"`);
    assertEquals(result, ["useState"]);
  });
});

describe("generateStubCode", () => {
  it("generates stub with default export", () => {
    const result = generateStubCode("/path/to/module.js");
    assertEquals(result.includes("export default"), true);
    assertEquals(result.includes("Proxy"), true);
  });

  it("generates stub with named exports", () => {
    const result = generateStubCode("/path/to/module.js", ["foo", "bar"]);
    assertEquals(result.includes("export const foo"), true);
    assertEquals(result.includes("export const bar"), true);
  });

  it("includes module path in error messages", () => {
    const result = generateStubCode("/my/module.js");
    assertEquals(result.includes("/my/module.js"), true);
    assertEquals(result.includes("MissingModuleError"), true);
  });

  it("handles empty named imports", () => {
    const result = generateStubCode("/mod.js", []);
    assertEquals(result.includes("export default"), true);
    // No named exports when array is empty
    assertEquals(result.includes("export const"), false);
  });
});

describe("createStubModule", () => {
  it("atomically publishes generated stub modules", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-stub-atomic-" });
    const localFs = getLocalFs();
    const originalWriteTextFile = localFs.writeTextFile.bind(localFs);
    const originalRename = localFs.rename?.bind(localFs);
    if (!originalRename) throw new Error("Test filesystem must support rename");
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    localFs.writeTextFile = async (path, data) => {
      writes.push(path);
      await originalWriteTextFile(path, data);
    };
    localFs.rename = async (from, to) => {
      renames.push([from, to]);
      await originalRename(from, to);
    };

    try {
      const stubPath = await createStubModule(
        "missing-module",
        `import { value } from "missing-module";`,
        `from "missing-module"`,
        cacheDir,
      );
      if (!stubPath) throw new Error("Expected a stub module");

      const temporaryWrite = writes.find((path) => path.startsWith(`${stubPath}.tmp-`));
      assertEquals(typeof temporaryWrite, "string");
      assertEquals(renames, [[temporaryWrite!, stubPath]]);
      assertEquals((await readTextFile(stubPath)).includes("export const value"), true);
    } finally {
      localFs.writeTextFile = originalWriteTextFile;
      localFs.rename = originalRename;
      await remove(cacheDir, { recursive: true }).catch(() => {});
    }
  });
});
