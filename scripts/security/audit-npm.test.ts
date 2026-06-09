import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { buildAuditPackageJson, collectNpmDependencies } from "./audit-npm.ts";

describe("collectNpmDependencies", () => {
  it("collects pinned npm imports across root and extension manifests", () => {
    const deps = collectNpmDependencies([
      {
        sourceLocation: "deno.json",
        imports: {
          "react": "npm:react@19.2.4",
        },
      },
      {
        sourceLocation: "extensions/ext-schema-zod/deno.json",
        imports: {
          "zod": "npm:zod@4.3.6",
        },
      },
      {
        sourceLocation: "extensions/ext-empty/deno.json",
        imports: {
          "#local": "./src/index.ts",
          "@std/path": "jsr:@std/path@1.1.2",
        },
      },
    ]);

    assertEquals(deps, {
      "react": "19.2.4",
      "zod": "4.3.6",
    });
  });

  it("preserves multiple versions of the same package with audit aliases", () => {
    const deps = collectNpmDependencies([
      {
        sourceLocation: "extensions/ext-old/deno.json",
        imports: {
          "zod": "npm:zod@3.25.76",
        },
      },
      {
        sourceLocation: "extensions/ext-new/deno.json",
        imports: {
          "zod": "npm:zod@4.3.6",
        },
      },
    ]);

    assertEquals(deps, {
      "zod": "3.25.76",
      "vf-audit-zod-4-3-6": "npm:zod@4.3.6",
    });
  });
});

describe("buildAuditPackageJson", () => {
  it("keeps native runtime dependencies in the temporary audit package", () => {
    const pkg = buildAuditPackageJson({
      "better-sqlite3": "12.4.6",
    });

    assertEquals(pkg.dependencies, {
      "better-sqlite3": "12.4.6",
    });
    assertEquals(pkg.peerDependencies, undefined);
    assertEquals(pkg.peerDependenciesMeta, undefined);
  });
});
