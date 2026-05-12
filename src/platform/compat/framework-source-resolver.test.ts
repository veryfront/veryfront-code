import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getFrameworkSourceLookupDirs,
  resolveFrameworkSourcePath,
} from "./framework-source-resolver.ts";

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

          throw new Error("not found");
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

          throw new Error("not found");
        },
      },
    });

    assertEquals(result?.path, "/framework/dist/framework-src/react/router/index.tsx.src");
  });

  it("deduplicates lookup directories while preserving order", () => {
    const lookupDirs = getFrameworkSourceLookupDirs(["/custom", "/custom"]);
    assertEquals(lookupDirs.filter((dir) => dir === "/custom").length, 1);
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
          throw new Error("not found");
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
          throw new Error("not found");
        },
      },
    });
    assertEquals(result?.path, target);
  });
});
