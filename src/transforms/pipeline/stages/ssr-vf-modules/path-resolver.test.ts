import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveFrameworkFile,
  resolveRelativeFrameworkImport,
  resolveVeryfrontSourcePath,
  tryReadWithExtensions,
} from "./path-resolver.ts";
import { EMBEDDED_SRC_DIR, FRAMEWORK_ROOT, getFrameworkLookups } from "./constants.ts";

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

function nonCanonicalNotFoundFailures(): ReadonlyArray<readonly [string, unknown]> {
  return [
    ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
    [
      "a native Error with a plain ENOENT-shaped cause",
      new Error("wrapped framework source failure", {
        cause: Object.freeze({ code: "ENOENT" }),
      }),
    ],
  ];
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

  it("propagates a preferred embedded-source read failure without selecting a fallback", async () => {
    const permissionError = new Deno.errors.PermissionDenied("preferred source is unreadable");
    const fs = {
      readTextFile: (path: string) => {
        if (path === "/src/utils.ts.src") return Promise.reject(permissionError);
        if (path === "/src/utils.ts") return Promise.resolve("regular source");
        return Promise.reject(new Deno.errors.NotFound(path));
      },
    } as any;
    const existsFn = async (path: string) =>
      path === "/src/utils.ts.src" || path === "/src/utils.ts";

    const error = await assertRejects(() => tryReadWithExtensions(fs, "/src/utils", existsFn));

    assertStrictEquals(error, permissionError);
  });

  it("propagates operational extension-probe failures", async () => {
    const ioError = Object.assign(new Error("framework source probe failed"), { code: "EIO" });

    const error = await assertRejects(() =>
      tryReadWithExtensions(createMockFs({}), "/src/utils", async () => {
        throw ioError;
      })
    );

    assertStrictEquals(error, ioError);
  });

  for (const [label, failure] of nonCanonicalNotFoundFailures()) {
    it(`propagates ${label} from a preferred source read without selecting a fallback`, async () => {
      let probeCalls = 0;
      let readCalls = 0;
      const fs = {
        readTextFile: () => {
          readCalls++;
          return Promise.reject(failure);
        },
      } as any;

      const error = await assertRejects(() =>
        tryReadWithExtensions(fs, "/src/utils", () => {
          probeCalls++;
          return Promise.resolve(true);
        })
      );

      assertStrictEquals(error, failure);
      assertEquals(probeCalls, 1);
      assertEquals(readCalls, 1);
    });
  }

  it("continues after a positively probed source disappears before it is read", async () => {
    const fs = {
      readTextFile: (path: string) => {
        if (path === "/src/utils.ts.src") {
          return Promise.reject(new Deno.errors.NotFound("embedded source disappeared"));
        }
        if (path === "/src/utils.ts") return Promise.resolve("regular source");
        return Promise.reject(new Deno.errors.NotFound(path));
      },
    } as any;
    const existsFn = async (path: string) =>
      path === "/src/utils.ts.src" || path === "/src/utils.ts";

    const result = await tryReadWithExtensions(fs, "/src/utils", existsFn);

    assertEquals(result, {
      sourcePath: "/src/utils.ts",
      content: "regular source",
    });
  });
});

describe("resolveVeryfrontSourcePath", () => {
  it("propagates operational framework-source probe failures", async () => {
    const ioError = Object.assign(new Error("framework source lookup failed"), { code: "EIO" });

    const error = await assertRejects(() =>
      resolveVeryfrontSourcePath("#veryfront/utils", async () => {
        throw ioError;
      })
    );

    assertStrictEquals(error, ioError);
  });

  for (const [label, failure] of nonCanonicalNotFoundFailures()) {
    it(`propagates ${label} from the first framework-source probe without trying fallbacks`, async () => {
      let probeCalls = 0;

      const error = await assertRejects(() =>
        resolveVeryfrontSourcePath("#veryfront/utils", () => {
          probeCalls++;
          return Promise.reject(failure);
        })
      );

      assertStrictEquals(error, failure);
      assertEquals(probeCalls, 1);
    });
  }
});

describe("resolveFrameworkFile", () => {
  it("prefers pristine embedded sources in compiled binaries", () => {
    const lookups = getFrameworkLookups(true);

    assertEquals(lookups[0]?.[1], EMBEDDED_SRC_DIR);
    assertEquals(lookups[1]?.[1], join(FRAMEWORK_ROOT, "src"));
  });

  it("returns null for unresolvable paths", async () => {
    const fs = createMockFs({});
    const result = await resolveFrameworkFile(
      "/_vf_modules/_veryfront/nonexistent",
      fs,
      async () => false,
    );
    assertEquals(result, null);
  });

  it("normalizes file:///_vf_modules paths before resolving", async () => {
    const sourcePath = join(FRAMEWORK_ROOT, "src", "react", "runtime", "core.ts");
    const files: Record<string, string> = {
      [sourcePath]: "export function usePageContext() {}",
    };
    const fs = createMockFs(files);
    const result = await resolveFrameworkFile(
      "file:///_vf_modules/_veryfront/react/runtime/core.js?ssr=true",
      fs,
      createExistsFn(files),
    );
    assertEquals(result?.sourcePath, sourcePath);
    assertEquals(result?.content, "export function usePageContext() {}");
  });

  for (
    const maliciousPath of [
      "/_vf_modules/_veryfront/../../secret.js",
      "/_vf_modules/_veryfront/%252e%252e/secret.js",
      "/_vf_modules/_veryfront/..\\..\\secret.js",
    ]
  ) {
    it(`rejects framework traversal path ${maliciousPath}`, async () => {
      const fs = createMockFs(
        new Proxy({}, {
          has: () => true,
          get: () => "secret",
        }) as Record<string, string>,
      );

      const result = await resolveFrameworkFile(maliciousPath, fs, async () => true);

      assertEquals(result, null);
    });
  }
});

describe("resolveRelativeFrameworkImport", () => {
  it("resolves relative import with explicit extension", async () => {
    const sourceDir = join(FRAMEWORK_ROOT, "src", "foo", "bar");
    const expected = join(sourceDir, "Head.tsx");
    const files: Record<string, string> = { [expected]: "export default Head;" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./Head.tsx",
      join(sourceDir, "index.ts"),
      fs,
      createExistsFn(files),
    );
    assertEquals(result, expected);
  });

  it("resolves parent directory import", async () => {
    const sourceRoot = join(FRAMEWORK_ROOT, "src", "foo");
    const expected = join(sourceRoot, "utils.ts");
    const files: Record<string, string> = { [expected]: "export const x = 1;" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "../utils",
      join(sourceRoot, "bar", "index.ts"),
      fs,
      createExistsFn(files),
    );
    assertEquals(result, expected);
  });

  it("returns null for non-existent relative import", async () => {
    const fs = createMockFs({});
    const result = await resolveRelativeFrameworkImport(
      "./missing.tsx",
      join(FRAMEWORK_ROOT, "src", "foo", "bar", "index.ts"),
      fs,
      async () => false,
    );
    assertEquals(result, null);
  });

  it("tries .src extension for embedded sources", async () => {
    const sourceDir = join(EMBEDDED_SRC_DIR, "foo", "bar");
    const expected = join(sourceDir, "Head.tsx.src");
    const files: Record<string, string> = { [expected]: "embedded" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./Head.tsx",
      join(sourceDir, "index.ts.src"),
      fs,
      createExistsFn(files),
    );
    assertEquals(result, expected);
  });

  it("resolves import without extension by probing", async () => {
    const sourceDir = join(FRAMEWORK_ROOT, "src", "foo", "bar");
    const expected = join(sourceDir, "utils.ts");
    const files: Record<string, string> = { [expected]: "code" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./utils",
      join(sourceDir, "index.ts"),
      fs,
      createExistsFn(files),
    );
    assertEquals(result, expected);
  });

  it("resolves transpiled .js imports back to embedded TypeScript sources", async () => {
    const sourceDir = join(EMBEDDED_SRC_DIR, "foo", "bar");
    const expected = join(sourceDir, "csp-nonce.ts.src");
    const files: Record<string, string> = { [expected]: "embedded" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./csp-nonce.js",
      join(sourceDir, "Head.tsx.src"),
      fs,
      createExistsFn(files),
    );
    assertEquals(result, expected);
  });

  it("falls back from extracted framework src paths to embedded framework sources in compiled binaries", async () => {
    const files: Record<string, string> = {
      "/tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src": "embedded",
    };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "../runtime/core.ts",
      "/tmp/deno-compile-veryfront/src/react/context/index.tsx",
      fs,
      createExistsFn(files),
    );
    assertEquals(
      result,
      "/tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src",
    );
  });

  it("resolves sibling framework component imports from compiled-binary extracted paths", async () => {
    const files: Record<string, string> = {
      "/tmp/deno-compile-veryfront/dist/framework-src/react/components/Head.tsx.src": "embedded",
    };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "../components/Head.tsx",
      "/tmp/deno-compile-veryfront/src/react/fonts/index.ts",
      fs,
      createExistsFn(files),
    );
    assertEquals(
      result,
      "/tmp/deno-compile-veryfront/dist/framework-src/react/components/Head.tsx.src",
    );
  });
});
