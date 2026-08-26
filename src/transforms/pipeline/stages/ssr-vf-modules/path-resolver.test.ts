import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveFrameworkFile,
  resolveRelativeFrameworkImport,
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
  it("prefers pristine embedded sources in compiled binaries", () => {
    const lookups = getFrameworkLookups(true);

    assertEquals(lookups[0]?.[1], EMBEDDED_SRC_DIR);
    assertEquals(lookups[1]?.[1], join(FRAMEWORK_ROOT, "src"));
  });

  it("prefers live src files in source checkouts", () => {
    const lookups = getFrameworkLookups(false);

    assertEquals(
      lookups[0]?.[1],
      join(FRAMEWORK_ROOT, "src"),
      "source checkouts look at live src/ first so local edits are not shadowed",
    );
    assertEquals(
      lookups[1]?.[1],
      EMBEDDED_SRC_DIR,
      "generated embedded sources stay the fallback in source checkouts",
    );
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
    const privilegedPath of [
      "/_vf_modules/_veryfront/platform/compat/process/env.js",
      "/_vf_modules/_veryfront/platform/compat/process/env.js?ssr=true",
      "/_vf_modules/_veryfront/platform/compat/process/env.ts",
      "/_vf_modules/_veryfront/platform/compat/process/runtime-process.js",
      "/_vf_modules/_veryfront/platform/compat/process/scoped-process-env.js",
      "/_vf_modules/_veryfront/platform/compat/process.js",
      "/_vf_modules/_veryfront/platform/cloud/resolver.js",
      "file:///_vf_modules/_veryfront/platform/compat/process/env.js?ssr=true",
    ]
  ) {
    it(`refuses privileged framework module ${privilegedPath}`, async () => {
      const fs = createMockFs(
        new Proxy({}, {
          has: () => true,
          get: () => "export function getHostEnv() {}",
        }) as Record<string, string>,
      );

      const result = await resolveFrameworkFile(privilegedPath, fs, async () => true);

      assertEquals(result, null);
    });
  }

  it("refuses an unexported host-environment wrapper as a tenant entry", async () => {
    const fs = createMockFs(
      new Proxy({}, {
        has: () => true,
        get: () => "export function getHostTelemetryEnv() {}",
      }) as Record<string, string>,
    );

    assertEquals(
      await resolveFrameworkFile(
        "/_vf_modules/_veryfront/observability/tracing/telemetry-env.js",
        fs,
        () => Promise.resolve(true),
      ),
      null,
    );
  });

  it("still resolves the public platform/env facade", async () => {
    const sourcePath = join(
      FRAMEWORK_ROOT,
      "src",
      "platform",
      "compat",
      "process",
      "env-public.ts",
    );
    const files: Record<string, string> = {
      [sourcePath]: 'export { getEnv } from "./env.ts";',
    };
    const fs = createMockFs(files);
    const result = await resolveFrameworkFile(
      "/_vf_modules/_veryfront/platform/compat/process/env-public.js?ssr=true",
      fs,
      createExistsFn(files),
    );
    assertEquals(result?.sourcePath, sourcePath);
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
    const indexPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "index.ts");
    const headPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "Head.tsx");
    const files: Record<string, string> = { [headPath]: "export default Head;" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./Head.tsx",
      indexPath,
      fs,
      createExistsFn(files),
    );
    assertEquals(result, headPath);
  });

  it("resolves parent directory import", async () => {
    const indexPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "index.ts");
    const utilsPath = join(FRAMEWORK_ROOT, "src", "foo", "utils.ts");
    const files: Record<string, string> = { [utilsPath]: "export const x = 1;" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "../utils",
      indexPath,
      fs,
      createExistsFn(files),
    );
    assertEquals(result, utilsPath);
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
    const indexPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "index.ts");
    const headPath = join(FRAMEWORK_ROOT, "dist", "framework-src", "foo", "bar", "Head.tsx.src");
    const files: Record<string, string> = { [headPath]: "embedded" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./Head.tsx",
      indexPath,
      fs,
      createExistsFn(files),
    );
    assertEquals(result, headPath);
  });

  it("resolves import without extension by probing", async () => {
    const indexPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "index.ts");
    const utilsPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "utils.ts");
    const files: Record<string, string> = { [utilsPath]: "code" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./utils",
      indexPath,
      fs,
      createExistsFn(files),
    );
    assertEquals(result, utilsPath);
  });

  it("resolves transpiled .js imports back to embedded TypeScript sources", async () => {
    const headPath = join(FRAMEWORK_ROOT, "src", "foo", "bar", "Head.tsx");
    const noncePath = join(
      FRAMEWORK_ROOT,
      "dist",
      "framework-src",
      "foo",
      "bar",
      "csp-nonce.ts.src",
    );
    const files: Record<string, string> = { [noncePath]: "embedded" };
    const fs = createMockFs(files);
    const result = await resolveRelativeFrameworkImport(
      "./csp-nonce.js",
      headPath,
      fs,
      createExistsFn(files),
    );
    assertEquals(result, noncePath);
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
