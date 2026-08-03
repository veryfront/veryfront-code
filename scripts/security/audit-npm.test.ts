import { parse } from "#std/yaml/parse";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

describe("audit task", () => {
  it("audits the independent Storybook package lock", async () => {
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const workflow = await Deno.readTextFile(
      ".github/workflows/security-audit.yml",
    );
    const pullRequestPaths = (parse(workflow) as {
      on: { pull_request: { paths: string[] } };
    }).on.pull_request.paths;

    assertEquals(
      denoConfig.tasks.audit.includes(
        "npm --prefix storybook audit --package-lock-only --audit-level=high",
      ),
      true,
    );
    assertEquals(pullRequestPaths.includes("storybook/package.json"), true);
    assertEquals(
      pullRequestPaths.includes("storybook/package-lock.json"),
      true,
    );
  });
});
