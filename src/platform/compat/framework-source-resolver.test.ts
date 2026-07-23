import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, remove, symlink, writeTextFile } from "./fs.ts";
import {
  FRAMEWORK_EMBEDDED_SRC_DIR,
  FRAMEWORK_SRC_DIR,
  getFrameworkSourceLookupDirs,
  resolveFrameworkSourcePath,
  resolveRelativeFrameworkSourceImport,
} from "./framework-source-resolver.ts";

const identityRealPath = (path: string): Promise<string> => Promise.resolve(path);
const notFound = (): Error => Object.assign(new Error("not found"), { code: "ENOENT" });

describe("platform/compat/framework-source-resolver", () => {
  it("prefers live framework src before embedded sources", async () => {
    const stats = new Map<string, boolean>([
      ["/framework/src/react/router/index.tsx", true],
      ["/framework/dist/framework-src/react/router/index.tsx.src", true],
    ]);

    const result = await resolveFrameworkSourcePath("react/router", {
      extraLookupDirs: ["/framework/src", "/framework/dist/framework-src"],
      fileSystem: {
        stat: async (path: string) => {
          if (stats.get(path)) {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              isSymbolicLink: false,
              size: 0,
              mtime: null,
            };
          }

          throw notFound();
        },
      },
      realPath: identityRealPath,
    });

    assertEquals(result?.path, "/framework/src/react/router/index.tsx");
  });

  it("falls back to embedded sources when live src is missing", async () => {
    const result = await resolveFrameworkSourcePath("react/router", {
      extraLookupDirs: ["/framework/src", "/framework/dist/framework-src"],
      fileSystem: {
        stat: async (path: string) => {
          if (path === "/framework/dist/framework-src/react/router/index.tsx.src") {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              isSymbolicLink: false,
              size: 0,
              mtime: null,
            };
          }

          throw notFound();
        },
      },
      realPath: identityRealPath,
    });

    assertEquals(result?.path, "/framework/dist/framework-src/react/router/index.tsx.src");
  });

  it("deduplicates lookup directories while preserving order", () => {
    const lookupDirs = getFrameworkSourceLookupDirs(["/custom", "/custom"]);
    assertEquals(lookupDirs.filter((dir) => dir === "/custom").length, 1);
  });

  it("prefers pristine embedded sources in compiled binaries", () => {
    assertEquals(getFrameworkSourceLookupDirs([], true), [
      FRAMEWORK_EMBEDDED_SRC_DIR,
      FRAMEWORK_SRC_DIR,
    ]);
  });

  it("prefers the embedded counterpart for compiled-binary relative imports", async () => {
    const livePath = `${FRAMEWORK_SRC_DIR}/react/runtime/core.ts`;
    const embeddedPath = `${FRAMEWORK_EMBEDDED_SRC_DIR}/react/runtime/core.ts.src`;

    const result = await resolveRelativeFrameworkSourceImport(
      "../runtime/core.ts",
      `${FRAMEWORK_SRC_DIR}/react/context/index.tsx`,
      {
        compiled: true,
        exists: (path) => Promise.resolve(path === livePath || path === embeddedPath),
      },
    );

    assertEquals(result, embeddedPath);
  });

  it("keeps relative imports inside the embedded tree when both trees exist", async () => {
    const livePath = `${FRAMEWORK_SRC_DIR}/react/runtime/core.ts`;
    const embeddedPath = `${FRAMEWORK_EMBEDDED_SRC_DIR}/react/runtime/core.ts.src`;

    const result = await resolveRelativeFrameworkSourceImport(
      "../runtime/core.ts",
      `${FRAMEWORK_EMBEDDED_SRC_DIR}/react/context/index.tsx.src`,
      {
        compiled: true,
        exists: (path) => Promise.resolve(path === livePath || path === embeddedPath),
      },
    );

    assertEquals(result, embeddedPath);
  });

  it("rejects relative imports that escape the source tree before probing", async () => {
    const probed: string[] = [];
    const result = await resolveRelativeFrameworkSourceImport(
      "../../../../outside.ts",
      `${FRAMEWORK_SRC_DIR}/react/context/index.tsx`,
      {
        exists: (path) => {
          probed.push(path);
          return Promise.resolve(true);
        },
      },
    );

    assertEquals(result, null);
    assertEquals(probed, []);
  });

  it("allows only the generated compatibility files at the framework root", async () => {
    const shimPath = "/framework/_dnt.shims.js";
    const result = await resolveRelativeFrameworkSourceImport(
      "../../_dnt.shims.js",
      "/framework/src/runtime/index.ts",
      {
        exists: (path) => Promise.resolve(path === shimPath),
        realPath: identityRealPath,
      },
    );

    assertEquals(result, shimPath);

    const probed: string[] = [];
    const rejected = await resolveRelativeFrameworkSourceImport(
      "../../private.json",
      "/framework/src/runtime/index.ts",
      {
        exists: (path) => {
          probed.push(path);
          return Promise.resolve(true);
        },
        realPath: identityRealPath,
      },
    );

    assertEquals(rejected, null);
    assertEquals(probed, []);
  });

  it("rejects a relative import symlink that resolves outside the source tree", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-framework-resolver-" });
    const sourceDir = join(tempDir, "src");
    const outsidePath = join(tempDir, "outside.ts");
    const linkPath = join(sourceDir, "escape.ts");

    try {
      await mkdir(sourceDir, { recursive: true });
      await writeTextFile(outsidePath, "export const secret = true;\n");
      await symlink(outsidePath, linkPath);

      const result = await resolveRelativeFrameworkSourceImport(
        "./escape.ts",
        join(sourceDir, "index.ts"),
      );

      assertEquals(result, null);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("propagates operational filesystem failures", async () => {
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });

    await assertRejects(
      () =>
        resolveFrameworkSourcePath("react/router", {
          extraLookupDirs: ["/framework/src"],
          fileSystem: {
            stat: () => Promise.reject(denied),
          },
        }),
      Error,
      "permission denied",
    );
  });
});

// VULN-FS-3: resolveFrameworkSourcePath must not honour inputs that escape
// the lookup directory via traversal, percent-encoded traversal, or
// percent-encoded separators. The resolver is reachable from the public
// /_vf_modules/... route, so malicious inputs like
//   "_veryfront/%2e%2e%2fsecret.ts"
// must resolve to null (HTTP 404) rather than a real file outside the
// framework source tree.
describe("framework-source-resolver (VULN-FS-3) — path containment", () => {
  // Build a stat that claims EVERY probed path is a real file, so the only
  // thing preventing escape is the validator.
  const alwaysExistsFs = {
    stat: async (_path: string) => ({
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isSymbolicLink: false,
      size: 0,
      mtime: null,
    }),
  };

  const MALICIOUS_INPUTS: ReadonlyArray<[string, string]> = [
    ["plain traversal", "../../etc/passwd"],
    ["traversal inside subpath", "react/../../../etc/passwd"],
    ["percent-encoded dot (lower)", "react/%2e%2e/%2e%2e/etc/passwd"],
    ["percent-encoded dot (upper)", "react/%2E%2E/%2E%2E/etc/passwd"],
    ["percent-encoded slash", "react%2f..%2f..%2fetc%2fpasswd"],
    ["percent-encoded backslash", "react%5c..%5c..%5cetc%5cpasswd"],
    ["double-encoded traversal", "react/%252e%252e/etc/passwd"],
    ["NUL byte", "react/\0../etc/passwd"],
    ["percent-encoded NUL", "react/%00/etc/passwd"],
    ["windows-style separator", "react\\..\\..\\etc\\passwd"],
  ];

  for (const [label, input] of MALICIOUS_INPUTS) {
    it(`returns null for ${label}`, async () => {
      const result = await resolveFrameworkSourcePath(input, {
        extraLookupDirs: ["/framework/src"],
        fileSystem: alwaysExistsFs,
      });
      assertEquals(result, null, `must not resolve ${label}: ${input}`);
    });
  }

  it("positive: normal framework path still resolves", async () => {
    const result = await resolveFrameworkSourcePath("react/router", {
      extraLookupDirs: ["/framework/src"],
      fileSystem: {
        stat: async (path: string) => {
          if (path === "/framework/src/react/router.tsx") {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              isSymbolicLink: false,
              size: 0,
              mtime: null,
            };
          }
          throw notFound();
        },
      },
      realPath: identityRealPath,
    });
    // Regardless of which extension wins first, result must be non-null and
    // contained within the lookup dir.
    assertEquals(result !== null, true);
    if (result) {
      assertEquals(result.path.startsWith("/framework/src/"), true);
    }
  });

  it("positive: unicode NFC filename still resolves", async () => {
    const target = "/framework/src/caf\u00E9.tsx";
    const result = await resolveFrameworkSourcePath("caf\u00E9", {
      extraLookupDirs: ["/framework/src"],
      fileSystem: {
        stat: async (path: string) => {
          if (path === target) {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              isSymbolicLink: false,
              size: 0,
              mtime: null,
            };
          }
          throw notFound();
        },
      },
      realPath: identityRealPath,
    });
    assertEquals(result?.path, target);
  });

  it("rejects a source symlink that resolves outside its lookup directory", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-framework-lookup-" });
    const sourceDir = join(tempDir, "src");
    const outsidePath = join(tempDir, "outside.ts");
    const linkPath = join(sourceDir, "escape.ts");

    try {
      await mkdir(sourceDir, { recursive: true });
      await writeTextFile(outsidePath, "export const secret = true;\n");
      await symlink(outsidePath, linkPath);

      const result = await resolveFrameworkSourcePath("escape", {
        extraLookupDirs: [sourceDir],
        extensions: [".ts"],
        includeIndexFallback: false,
      });

      assertEquals(result, null);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});
