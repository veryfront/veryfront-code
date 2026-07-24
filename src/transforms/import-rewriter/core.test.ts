import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  applySSRImportRewrites,
  applySSRImportRewritesAsync,
} from "#veryfront/modules/server/ssr-import-rewriter.ts";
import { rewriteDiscoveryImports, rewriteForDeno } from "#veryfront/discovery/import-rewriter.ts";
import { addHMRTimestamps, rewriteBareImports } from "#veryfront/transforms/esm/import-rewriter.ts";
import { TAILWIND_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  stripJsonImportAttributes,
  upgradeImportAssertions,
} from "#veryfront/transforms/esm/import-attributes.ts";
import {
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
} from "#veryfront/routing/api/module-loader/external-import-rewriter.ts";

describe("import rewrite compatibility golden tests", () => {
  it("preserves transform query and attribute output", async () => {
    assertEquals(
      await addHMRTimestamps(`import m from "./mod.js?v=1";`, "222"),
      `import m from "./mod.js?v=1&t=222";`,
    );
    assertEquals(
      await upgradeImportAssertions(`import data from "./a.json" assert { type: "json" };`),
      `import data from "./a.json" with { type: "json" };`,
    );
    assertEquals(
      await stripJsonImportAttributes(
        `import data from "./a.mjs" with { type: "json" };`,
        () => true,
      ),
      `import data from "./a.mjs";`,
    );
  });

  it("preserves browser bare rewrite output shape", async () => {
    assertEquals(
      await rewriteBareImports(`import tw from "tailwindcss";`, undefined, "19.1.1", "p1"),
      `import tw from "https://esm.sh/tailwindcss@${TAILWIND_VERSION}?external=react&target=es2022";`,
    );
  });

  it("preserves SSR exact query byte ordering", async () => {
    assertEquals(
      applySSRImportRewrites(`import X from "@/page";`, {
        projectSlug: "demo",
        branch: "main",
        cacheBuster: "abc",
      }),
      `import X from "/_vf_modules/page.js?ssr=true&project=demo&branch=main&v=abc";`,
    );
    assertEquals(
      await applySSRImportRewritesAsync(`import X from "@/page";`, {
        resolveCacheBuster: () => "resolved",
      }),
      `import X from "/_vf_modules/page.js?ssr=true&v=resolved";`,
    );
  });

  it("preserves Deno discovery rewrites", () => {
    const out = rewriteForDeno(
      [
        `import { tool } from "veryfront/tool";`,
        `import "reflect-metadata";`,
        `export { z } from "zod";`,
        `import type { ZodSchema } from "zod";`,
      ].join("\n"),
      "/project/tools",
      { compiled: true },
    );
    assertStringIncludes(out, `globalThis.__VERYFRONT_MODULES__["veryfront/tool"]`);
    assertStringIncludes(out, `import "npm:reflect-metadata"`);
    assertStringIncludes(out, `export { z } from "npm:zod"`);
    assertStringIncludes(out, `import type { ZodSchema } from "zod"`);
  });

  it("preserves Node discovery package metadata behavior", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-import-core-" });
    try {
      await Deno.mkdir(`${projectDir}/node_modules/pkg`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/node_modules/pkg/package.json`,
        JSON.stringify({ exports: { ".": "./index.js", "./*": "./*.js" } }),
      );
      await Deno.writeTextFile(`${projectDir}/node_modules/pkg/index.js`, "");
      await Deno.writeTextFile(`${projectDir}/node_modules/pkg/sub.js`, "");

      const out = await rewriteDiscoveryImports(
        [`import main from "pkg";`, `import sub from "pkg/sub";`].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(out, "pkg/index.js");
      assertStringIncludes(out, "pkg/sub.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves route loader compiled and Deno rewrites", async () => {
    assertEquals(
      rewriteCompiledBinaryVeryfrontImports(`import { x } from "veryfront/agent";`),
      `import { x } from "./_vf_agent.mjs";`,
    );
    assertStringIncludes(
      rewriteCompiledBinaryUserDependencyImports(
        `const m = import("lodash/merge");`,
        new Map([["lodash", "^4"]]),
      ),
      `Promise.resolve(require("lodash/merge"))`,
    );
    assertEquals(
      rewriteDenoNodeBuiltinImports(`import { readFile } from "fs";`),
      `import { readFile } from "node:fs";`,
    );

    const fs = createFileSystem();
    const projectDir = await Deno.makeTempDir({ prefix: "vf-route-rewrite-" });
    try {
      await Deno.mkdir(`${projectDir}/node_modules/lodash`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/node_modules/lodash/package.json`,
        JSON.stringify({ version: "4.17.21" }),
      );
      assertEquals(
        await rewriteDenoNpmDependencyImports(
          `import merge from "lodash/merge";`,
          projectDir,
          fs,
          new Map([["lodash", "^4"]]),
        ),
        `import merge from "npm:lodash@4.17.21/merge";`,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
