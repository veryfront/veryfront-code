import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applySSRImportRewrites, applySSRImportRewritesAsync } from "./ssr-import-rewriter.ts";

describe("modules/server/ssr-import-rewriter", () => {
  describe("applySSRImportRewrites - path aliases (@/)", () => {
    it("should rewrite @/ imports with ssr params", () => {
      const code = `import { Foo } from "@/components/Button";`;
      const result = applySSRImportRewrites(code, { cacheBuster: 1000 });
      assertEquals(
        result,
        `import { Foo } from "/_vf_modules/components/Button.js?ssr=true&v=1000";`,
      );
    });

    it("should preserve .js extension if already present", () => {
      const code = `import { Bar } from "@/lib/utils.js";`;
      const result = applySSRImportRewrites(code, { cacheBuster: 2000 });
      assertEquals(
        result,
        `import { Bar } from "/_vf_modules/lib/utils.js?ssr=true&v=2000";`,
      );
    });

    it("should include project slug", () => {
      const code = `import X from "@/page";`;
      const result = applySSRImportRewrites(code, {
        projectSlug: "demo",
        cacheBuster: 3000,
      });
      assertEquals(
        result,
        `import X from "/_vf_modules/page.js?ssr=true&project=demo&v=3000";`,
      );
    });

    it("should include branch param", () => {
      const code = `import Y from "@/layout";`;
      const result = applySSRImportRewrites(code, {
        branch: "feat-x",
        cacheBuster: 4000,
      });
      assertEquals(
        result,
        `import Y from "/_vf_modules/layout.js?ssr=true&branch=feat-x&v=4000";`,
      );
    });

    it("should include both project and branch", () => {
      const code = `import Z from "@/app";`;
      const result = applySSRImportRewrites(code, {
        projectSlug: "mysite",
        branch: "main",
        cacheBuster: 5000,
      });
      assertEquals(
        result,
        `import Z from "/_vf_modules/app.js?ssr=true&project=mysite&branch=main&v=5000";`,
      );
    });

    it("should encode project, branch, and cache identities as query values", () => {
      const code = `import Z from "@/app";`;
      const result = applySSRImportRewrites(code, {
        projectSlug: "site & docs",
        branch: "feature/a #1%",
        cacheBuster: "version&next#part",
      });
      assertEquals(
        result,
        `import Z from "/_vf_modules/app.js?ssr=true&project=site%20%26%20docs&branch=feature%2Fa%20%231%25&v=version%26next%23part";`,
      );
    });

    it("should reject query identities outside the supported boundary", () => {
      assertThrows(
        () =>
          applySSRImportRewrites(`import Z from "@/app";`, {
            branch: "x".repeat(1_025),
          }),
        TypeError,
      );
      assertThrows(
        () =>
          applySSRImportRewrites(`import Z from "@/app";`, {
            cacheBuster: "",
          }),
        TypeError,
      );
      assertThrows(
        () =>
          applySSRImportRewrites(`import Z from "@/app";`, {
            branch: "feature\u0000hidden",
          }),
        TypeError,
      );
    });

    it("should use cross-project ref when provided", () => {
      const code = `import A from "@/shared";`;
      const result = applySSRImportRewrites(code, {
        crossProjectRef: "demo@0.0",
        cacheBuster: 6000,
      });
      assertEquals(
        result,
        `import A from "/_vf_modules/_cross/demo@0.0/@/shared.js?ssr=true&v=6000";`,
      );
    });
  });

  describe("applySSRImportRewrites - relative imports", () => {
    it("should rewrite ./ relative imports with .js extension", () => {
      const code = `import { helper } from "./utils.js";`;
      const result = applySSRImportRewrites(code, { cacheBuster: 1000 });
      assertEquals(
        result,
        `import { helper } from "./utils.js?ssr=true&v=1000";`,
      );
    });

    it("should rewrite ../ relative imports", () => {
      const code = `import { shared } from "../common/shared.js";`;
      const result = applySSRImportRewrites(code, { cacheBuster: 2000 });
      assertEquals(
        result,
        `import { shared } from "../common/shared.js?ssr=true&v=2000";`,
      );
    });

    it("should rewrite absolute path imports starting with /", () => {
      const code = `import { root } from "/lib/root.js";`;
      const result = applySSRImportRewrites(code, { cacheBuster: 3000 });
      assertEquals(
        result,
        `import { root } from "/lib/root.js?ssr=true&v=3000";`,
      );
    });

    it("should include project and branch in relative imports", () => {
      const code = `import { fn } from "./mod.js";`;
      const result = applySSRImportRewrites(code, {
        projectSlug: "proj",
        branch: "dev",
        cacheBuster: 4000,
      });
      assertEquals(
        result,
        `import { fn } from "./mod.js?ssr=true&project=proj&branch=dev&v=4000";`,
      );
    });

    it("should not rewrite relative imports without .js extension", () => {
      const code = `import { fn } from "./mod";`;
      const result = applySSRImportRewrites(code, { cacheBuster: 1000 });
      assertEquals(result.includes("./mod?ssr"), false);
    });
  });

  describe("applySSRImportRewritesAsync - query encoding", () => {
    it("should encode asynchronously resolved cache identities", async () => {
      const result = await applySSRImportRewritesAsync(
        `import { helper } from "./utils.js";`,
        {
          branch: "feature/docs",
          resolveCacheBuster: () => "content&revision",
        },
      );
      assertEquals(
        result,
        `import { helper } from "./utils.js?ssr=true&branch=feature%2Fdocs&v=content%26revision";`,
      );
    });

    it("should reject invalid asynchronously resolved cache identities", async () => {
      await assertRejects(
        () =>
          applySSRImportRewritesAsync(`import Z from "@/app";`, {
            resolveCacheBuster: () => "\ud800",
          }),
        TypeError,
      );
    });
  });

  describe("applySSRImportRewritesAsync - lexer-bounded imports", () => {
    it("rewrites every literal ESM import form without touching strings or comments", async () => {
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

    it("rewrites bare side-effect, re-export, and dynamic imports", async () => {
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

    it("preserves runtime protocols and Node package-import aliases", async () => {
      const code = [
        `import value from "data:text/javascript,export default 1";`,
        `export { internal } from "#internal";`,
      ].join("\n");

      assertEquals(await applySSRImportRewritesAsync(code), code);
    });
  });

  describe("applySSRImportRewrites - multiple imports", () => {
    it("should rewrite multiple imports in same code", () => {
      const code = [
        `import { A } from "@/components/A";`,
        `import { B } from "./local.js";`,
      ].join("\n");
      const result = applySSRImportRewrites(code, { cacheBuster: 9999 });
      assertEquals(result.includes("/_vf_modules/components/A.js?ssr=true"), true);
      assertEquals(result.includes("./local.js?ssr=true"), true);
    });

    it("uses deterministic default versions for the same target", () => {
      const originalNow = Date.now;
      try {
        Date.now = () => 1;
        const first = applySSRImportRewrites([
          `import { A } from "@/components/A";`,
          `import { helper } from "./local.js";`,
        ].join("\n"));

        Date.now = () => 2;
        const second = applySSRImportRewrites([
          `import { A } from "@/components/A";`,
          `import { helper } from "./local.js";`,
        ].join("\n"));

        assertEquals(second, first);
      } finally {
        Date.now = originalNow;
      }
    });

    it("versions each rewritten target independently", () => {
      const result = applySSRImportRewrites([
        `import { A } from "@/components/A";`,
        `import { B } from "@/components/B";`,
        `import { helper } from "./local.js";`,
      ].join("\n"));

      const versions = Array.from(result.matchAll(/[?&]v=([^"']+)/g), (match) => match[1]);

      assertEquals(versions.length, 3);
      assertEquals(new Set(versions).size, 3);
    });

    it("uses async per-target version resolver when provided", async () => {
      const code = [
        `import { A } from "@/components/A";`,
        `import { B } from "./local.js";`,
      ].join("\n");

      const result = await applySSRImportRewritesAsync(code, {
        resolveCacheBuster: (target) => {
          if (target.modulePath === "components/A.js") return "hash-a";
          if (target.specifier === "./local.js") return "hash-local";
          return "fallback";
        },
      });

      assertEquals(
        result,
        [
          `import { A } from "/_vf_modules/components/A.js?ssr=true&v=hash-a";`,
          `import { B } from "./local.js?ssr=true&v=hash-local";`,
        ].join("\n"),
      );
    });
  });

  describe("applySSRImportRewrites - passthrough", () => {
    it("should not modify code without imports", () => {
      const code = `const x = 42;\nconsole.log(x);`;
      const result = applySSRImportRewrites(code, { cacheBuster: 1000 });
      assertEquals(result, code);
    });
  });
});
