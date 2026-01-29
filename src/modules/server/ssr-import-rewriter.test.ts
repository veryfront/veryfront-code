import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applySSRImportRewrites } from "./ssr-import-rewriter.ts";

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
      // relative import regex requires .js extension
      assertEquals(result.includes("./mod?ssr"), false);
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
  });

  describe("applySSRImportRewrites - passthrough", () => {
    it("should not modify code without imports", () => {
      const code = `const x = 42;\nconsole.log(x);`;
      const result = applySSRImportRewrites(code, { cacheBuster: 1000 });
      assertEquals(result, code);
    });
  });
});
