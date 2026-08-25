import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  FRAMEWORK_EMBEDDED_SRC_DIR,
  FRAMEWORK_SRC_DIR,
  getFrameworkSourceLookupDirs,
  isPrivilegedFrameworkSourceKey,
  resolveFrameworkSourcePath,
  resolveRelativeFrameworkSourceImport,
} from "./framework-source-resolver.ts";

const notFound = (): Error =>
  Object.assign(new Error("not found"), {
    code: "ENOENT",
  });

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

  for (const helper of ["_dnt.shims.js", "_dnt.polyfills.js", "deno.js"]) {
    it(`resolves published runtime helper ${helper} outside the source tree`, async () => {
      const packageRoot = "/package/esm";
      const helperPath = `${packageRoot}/${helper}`;

      const result = await resolveRelativeFrameworkSourceImport(
        `../../${helper}`,
        `${packageRoot}/src/html/client-head-manager.js`,
        {
          exists: (path) => Promise.resolve(path === helperPath),
        },
      );

      assertEquals(result, helperPath);
    });
  }

  it("does not resolve published runtime helpers through extension fallback", async () => {
    const probed: string[] = [];
    const result = await resolveRelativeFrameworkSourceImport(
      "../../deno.js",
      "/package/esm/src/html/client-head-manager.js",
      {
        exists: (path) => {
          probed.push(path);
          return Promise.resolve(path === "/package/esm/deno.ts");
        },
      },
    );

    assertEquals(result, null);
    assertEquals(probed, ["/package/esm/deno.js"]);
  });

  it("rejects other files at the published package root", async () => {
    let probed = false;
    const result = await resolveRelativeFrameworkSourceImport(
      "../../package.json",
      "/package/esm/src/html/client-head-manager.js",
      {
        exists: () => {
          probed = true;
          return Promise.resolve(true);
        },
      },
    );

    assertEquals(result, null);
    assertEquals(probed, false);
  });

  it("rejects relative imports that escape the framework source tree", async () => {
    let probed = false;
    const result = await resolveRelativeFrameworkSourceImport(
      "../../../../../../etc/passwd",
      `${FRAMEWORK_SRC_DIR}/react/context/index.tsx`,
      {
        exists: () => {
          probed = true;
          return Promise.resolve(true);
        },
      },
    );

    assertEquals(result, null);
    assertEquals(probed, false);
  });

  it("rejects non-relative and backslash-based framework imports", async () => {
    const exists = () => Promise.resolve(true);
    assertEquals(
      await resolveRelativeFrameworkSourceImport(
        "/etc/passwd",
        `${FRAMEWORK_SRC_DIR}/react/context/index.tsx`,
        { exists },
      ),
      null,
    );
    assertEquals(
      await resolveRelativeFrameworkSourceImport(
        String.raw`..\\..\\secret`,
        `${FRAMEWORK_SRC_DIR}/react/context/index.tsx`,
        { exists },
      ),
      null,
    );
  });

  it("propagates operational stat failures", async () => {
    await assertRejects(
      () =>
        resolveFrameworkSourcePath("react/router", {
          extraLookupDirs: ["/framework/src"],
          fileSystem: {
            stat: () => Promise.reject(new Error("permission denied")),
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
    });
    assertEquals(result?.path, target);
  });
});

describe("framework-source-resolver — privileged source keys", () => {
  const privilegedKeys = [
    "platform/compat/process",
    "platform/compat/process.ts",
    "platform/compat/process.js",
    "platform/compat/process/env",
    "platform/compat/process/env.ts",
    "platform/compat/process/env.js",
    "platform/compat/process/env.ts.src",
    "platform/compat/process/env.js?ssr=true",
    "platform/compat/process/runtime-process.ts",
    "platform/compat/process/scoped-process-env.ts",
    "platform/compat/process/host-runtime.ts",
    "platform/compat/process/lifecycle.ts",
    "platform/compat/process/command.ts",
  ];

  for (const key of privilegedKeys) {
    it(`marks ${key} as privileged`, () => {
      assertEquals(isPrivilegedFrameworkSourceKey(key), true);
    });
  }

  const publicKeys = [
    "platform/env",
    "platform/env.ts",
    "platform/index",
    "platform/compat/fs",
    "platform/compat/path/index",
    "platform/compat/processor", // sibling name must not match by prefix
    "testing/index",
    "react/runtime/core",
  ];

  for (const key of publicKeys) {
    it(`keeps ${key} resolvable`, () => {
      assertEquals(isPrivilegedFrameworkSourceKey(key), false);
    });
  }
});
