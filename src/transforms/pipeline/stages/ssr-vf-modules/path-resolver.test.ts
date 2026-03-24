import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveFrameworkFile,
  resolveRelativeFrameworkImport,
  tryReadWithExtensions,
} from "./path-resolver.ts";

function createMockFs(files: Record<string, string>) {
  return {
    readTextFile: async (path: string) => {
      if (path in files) return files[path];
      throw new Error(`Not found: ${path}`);
    },
  } as any;
}

function createExistsFn(files: Record<string, string>) {
  return async (path: string) => path in files;
}

describe("tryReadWithExtensions", () => {
  it("finds file with .ts extension", async () => {
    const files: Record<string, string> = { "/src/utils.ts": "export const x = 1;" };
    const fs = createMockFs(files);
    const result = await tryReadWithExtensions(fs, "/src/utils", createExistsFn(files));
    assertEquals(result !== null, true);
    assertEquals(result!.sourcePath, "/src/utils.ts");
    assertEquals(result!.content, "export const x = 1;");
  });

  it("finds file with .tsx extension", async () => {
    const files: Record<string, string> = { "/src/App.tsx": "<div/>" };
    const fs = createMockFs(files);
    const result = await tryReadWithExtensions(fs, "/src/App", createExistsFn(files));
    assertEquals(result !== null, true);
    assertEquals(result!.sourcePath, "/src/App.tsx");
  });

  it("returns null when no matching file", async () => {
    const fs = createMockFs({});
    const result = await tryReadWithExtensions(fs, "/src/missing", async () => false);
    assertEquals(result, null);
  });

  it("prefers .src extensions (embedded sources)", async () => {
    const files: Record<string, string> = {
      "/src/utils.ts.src": "embedded source",
      "/src/utils.ts": "regular source",
    };
    const fs = createMockFs(files);
    const result = await tryReadWithExtensions(fs, "/src/utils", createExistsFn(files));
    assertEquals(result!.sourcePath, "/src/utils.ts.src");
  });
});

describe("resolveFrameworkFile", () => {
  it("returns null for unresolvable paths", async () => {
    const fs = createMockFs({});
    const result = await resolveFrameworkFile(
      "/_vf_modules/_veryfront/nonexistent",
      fs,
      async () => false,
    );
    assertEquals(result, null);
  });
});

describe("resolveRelativeFrameworkImport", () => {
  it("resolves relative import with explicit extension", async () => {
    const files: Record<string, string> = { "/foo/bar/Head.tsx": "export default Head;" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./Head.tsx",
      "/foo/bar/index.ts",
      fs,
      createExistsFn(files),
    );
    assertEquals(result, "/foo/bar/Head.tsx");
  });

  it("resolves parent directory import", async () => {
    const files: Record<string, string> = { "/foo/utils.ts": "export const x = 1;" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "../utils",
      "/foo/bar/index.ts",
      fs,
      createExistsFn(files),
    );
    assertEquals(result, "/foo/utils.ts");
  });

  it("returns null for non-existent relative import", async () => {
    const fs = createMockFs({});
    const result = await resolveRelativeFrameworkImport(
      "./missing.tsx",
      "/foo/bar/index.ts",
      fs,
      async () => false,
    );
    assertEquals(result, null);
  });

  it("tries .src extension for embedded sources", async () => {
    const files: Record<string, string> = { "/foo/bar/Head.tsx.src": "embedded" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./Head.tsx",
      "/foo/bar/index.ts",
      fs,
      createExistsFn(files),
    );
    assertEquals(result, "/foo/bar/Head.tsx.src");
  });

  it("resolves import without extension by probing", async () => {
    const files: Record<string, string> = { "/foo/bar/utils.ts": "code" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./utils",
      "/foo/bar/index.ts",
      fs,
      createExistsFn(files),
    );
    assertEquals(result, "/foo/bar/utils.ts");
  });
});
