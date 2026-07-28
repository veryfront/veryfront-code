import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applySSRImportRewritesAsync } from "./ssr-import-rewriter.ts";

describe("modules/server/ssr-import-rewriter", () => {
  it("rewrites aliases with encoded request identities", async () => {
    const result = await applySSRImportRewritesAsync(
      `import value from "@/components/Button";`,
      {
        projectSlug: "site & docs",
        branch: "feature/a #1%",
        cacheBuster: "version&next#part",
      },
    );

    assertEquals(
      result,
      `import value from "/_vf_modules/components/Button.js?ssr=true&project=site%20%26%20docs&branch=feature%2Fa%20%231%25&v=version%26next%23part";`,
    );
  });

  it("preserves alias JavaScript extensions and supports cross-project targets", async () => {
    assertEquals(
      await applySSRImportRewritesAsync(
        `export { value } from "@/shared.mjs";`,
        {
          crossProjectRef: "demo@0.0",
          cacheBuster: "revision",
        },
      ),
      `export { value } from "/_vf_modules/_cross/demo@0.0/@/shared.mjs?ssr=true&v=revision";`,
    );
    assertEquals(
      await applySSRImportRewritesAsync(
        `export { value } from "@/shared.js";`,
        {
          crossProjectRef: "demo@0.0",
          cacheBuster: "revision",
        },
      ),
      `export { value } from "/_vf_modules/_cross/demo@0.0/@/shared.js?ssr=true&v=revision";`,
    );
  });

  it("rewrites JavaScript relative and absolute module paths", async () => {
    const code = [
      `import { local } from "./local.js";`,
      `export * from "../shared.mjs";`,
      `const root = import("/lib/root.js");`,
      `import { untouched } from "./source.ts";`,
    ].join("\n");

    assertEquals(
      await applySSRImportRewritesAsync(code, {
        projectSlug: "project",
        branch: "main",
        cacheBuster: "revision",
      }),
      [
        `import { local } from "./local.js?ssr=true&project=project&branch=main&v=revision";`,
        `export * from "../shared.mjs?ssr=true&project=project&branch=main&v=revision";`,
        `const root = import("/lib/root.js?ssr=true&project=project&branch=main&v=revision");`,
        `import { untouched } from "./source.ts";`,
      ].join("\n"),
    );
  });

  it("rejects malformed or unbounded query identities", async () => {
    for (
      const options of [
        { branch: "x".repeat(1_025) },
        { cacheBuster: "" },
        { branch: "feature\u0000hidden" },
        { cacheBuster: "\ud800" },
      ]
    ) {
      await assertRejects(
        () =>
          applySSRImportRewritesAsync(
            `import value from "@/app";`,
            options,
          ),
        TypeError,
      );
    }
  });

  it("uses an asynchronous cache identity for each target", async () => {
    const code = [
      `import { first } from "@/components/First";`,
      `import { second } from "./second.js";`,
    ].join("\n");

    assertEquals(
      await applySSRImportRewritesAsync(code, {
        resolveCacheBuster: (target) => target.kind === "alias" ? "hash-first" : "hash-second",
      }),
      [
        `import { first } from "/_vf_modules/components/First.js?ssr=true&v=hash-first";`,
        `import { second } from "./second.js?ssr=true&v=hash-second";`,
      ].join("\n"),
    );
  });

  it("rewrites every literal ESM form without touching comments or strings", async () => {
    const code = [
      `const text = 'import fake from "@/fake";';`,
      `// export { fake } from "./fake.js";`,
      `import "@/side-effect";`,
      `export { value } from "@/exported";`,
      `const lazy = import("./lazy.js");`,
      `export * from "../shared.mjs";`,
    ].join("\n");

    assertEquals(
      await applySSRImportRewritesAsync(code, { cacheBuster: "revision" }),
      [
        `const text = 'import fake from "@/fake";';`,
        `// export { fake } from "./fake.js";`,
        `import "/_vf_modules/side-effect.js?ssr=true&v=revision";`,
        `export { value } from "/_vf_modules/exported.js?ssr=true&v=revision";`,
        `const lazy = import("./lazy.js?ssr=true&v=revision");`,
        `export * from "../shared.mjs?ssr=true&v=revision";`,
      ].join("\n"),
    );
  });

  it("rewrites bare imports in static, re-export, and dynamic forms", async () => {
    const code = [
      `import "react";`,
      `export { createRoot } from "react-dom/client";`,
      `const runtime = import("react/jsx-runtime");`,
    ].join("\n");

    const result = await applySSRImportRewritesAsync(code, {
      reactVersion: "19.1.1",
    });

    assertEquals(result.includes(`import "react"`), false);
    assertEquals(result.includes(`from "react-dom/client"`), false);
    assertEquals(result.includes(`import("react/jsx-runtime")`), false);
    assertEquals(result.match(/https:\/\/esm\.sh\//g)?.length, 3);
  });

  it("preserves explicit schemes and Node package-import aliases", async () => {
    const code = [
      `import value from "data:text/javascript,export default 1";`,
      `export { internal } from "#internal";`,
      `import fs from "node:fs";`,
    ].join("\n");

    assertEquals(await applySSRImportRewritesAsync(code), code);
  });

  it("derives stable, target-specific default versions", async () => {
    const code = [
      `import { first } from "@/components/First";`,
      `import { second } from "@/components/Second";`,
      `import { local } from "./local.js";`,
    ].join("\n");

    const first = await applySSRImportRewritesAsync(code);
    const second = await applySSRImportRewritesAsync(code);
    const versions = Array.from(
      first.matchAll(/[?&]v=([^"']+)/g),
      (match) => match[1],
    );

    assertEquals(second, first);
    assertEquals(versions.length, 3);
    assertEquals(new Set(versions).size, 3);
  });

  it("returns source without imports unchanged", async () => {
    const code = `const value = 42;\nconsole.log(value);`;
    assertEquals(await applySSRImportRewritesAsync(code), code);
  });
});
