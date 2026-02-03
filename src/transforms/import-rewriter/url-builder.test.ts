import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  addEsmShDeps,
  buildCrossProjectUrl,
  buildEsmShUrl,
  buildModuleServerUrl,
  buildReactUrl,
  buildVeryfrontModuleUrl,
  getReactImportMap,
  isEsmShUrl,
  normalizeExtension,
} from "./url-builder.ts";

describe("transforms/import-rewriter/url-builder", () => {
  describe("buildEsmShUrl", () => {
    it("should build basic URL with package name", () => {
      assertEquals(buildEsmShUrl("lodash"), "https://esm.sh/lodash?target=es2022");
    });

    it("should include version", () => {
      assertEquals(buildEsmShUrl("react", "19.1.1"), "https://esm.sh/react@19.1.1?target=es2022");
    });

    it("should include subpath", () => {
      assertEquals(
        buildEsmShUrl("react", "19.1.1", "/jsx-runtime"),
        "https://esm.sh/react@19.1.1/jsx-runtime?target=es2022",
      );
    });

    it("should include external packages", () => {
      const url = buildEsmShUrl("react-dom", "19.1.1", undefined, { external: ["react"] });
      assertEquals(url.includes("external=react"), true);
    });

    it("should include deps", () => {
      const url = buildEsmShUrl("react", "19.1.1", undefined, { deps: { csstype: "3.2.3" } });
      assertEquals(url.includes("deps=csstype@3.2.3"), true);
    });

    it("should use custom target", () => {
      const url = buildEsmShUrl("lodash", undefined, undefined, { target: "es2020" });
      assertEquals(url.includes("target=es2020"), true);
    });
  });

  describe("buildReactUrl", () => {
    it("should build react URL with direct path format", () => {
      const url = buildReactUrl("react", "19.1.1");
      assertEquals(url.includes("react@19.1.1"), true);
      // Direct path format: /es2022/react.mjs
      assertEquals(url.includes("/es2022/react.mjs"), true);
    });

    it("should build react-dom URL with direct path format", () => {
      const url = buildReactUrl("react-dom", "19.1.1", undefined, true);
      // Direct path format, external param is ignored now
      assertEquals(url.includes("/es2022/react-dom.mjs"), true);
    });

    it("should build subpath URL with direct path format", () => {
      const url = buildReactUrl("react", "19.1.1", "/jsx-runtime", false);
      assertEquals(url.includes("/es2022/jsx-runtime.mjs"), true);
    });
  });

  describe("getReactImportMap", () => {
    it("should return map with react entries", () => {
      const map = getReactImportMap("19.1.1");
      const keys = [
        "react",
        "react-dom",
        "react-dom/client",
        "react-dom/server",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react/",
      ] as const;

      for (const key of keys) {
        assertEquals(typeof map[key], "string");
      }
    });
  });

  describe("buildModuleServerUrl", () => {
    it("should join base and path", () => {
      assertEquals(
        buildModuleServerUrl("http://localhost:3000", "/pages/index.js"),
        "http://localhost:3000/pages/index.js",
      );
    });

    it("should normalize trailing slash on base", () => {
      assertEquals(
        buildModuleServerUrl("http://localhost:3000/", "pages/index.js"),
        "http://localhost:3000/pages/index.js",
      );
    });

    it("should add leading slash to path if missing", () => {
      assertEquals(
        buildModuleServerUrl("http://localhost:3000", "pages/index.js"),
        "http://localhost:3000/pages/index.js",
      );
    });
  });

  describe("buildCrossProjectUrl", () => {
    it("should build cross-project URL with version", () => {
      assertEquals(
        buildCrossProjectUrl("my-project", "1.0.0", "components/Button.tsx"),
        "/_vf_modules/_cross/my-project@1.0.0/@/components/Button.tsx",
      );
    });

    it("should omit version when latest", () => {
      assertEquals(
        buildCrossProjectUrl("my-project", "latest", "lib/utils.tsx"),
        "/_vf_modules/_cross/my-project/@/lib/utils.tsx",
      );
    });

    it("should omit version when null", () => {
      assertEquals(
        buildCrossProjectUrl("my-project", null, "lib/utils.tsx"),
        "/_vf_modules/_cross/my-project/@/lib/utils.tsx",
      );
    });

    it("should add .tsx extension if no known extension", () => {
      assertEquals(
        buildCrossProjectUrl("proj", "1.0.0", "components/Button"),
        "/_vf_modules/_cross/proj@1.0.0/@/components/Button.tsx",
      );
    });
  });

  describe("buildVeryfrontModuleUrl", () => {
    it("should normalize .ts to .js", () => {
      assertEquals(
        buildVeryfrontModuleUrl("utils/helper.ts"),
        "/_vf_modules/_veryfront/utils/helper.js",
      );
    });

    it("should normalize .tsx to .js", () => {
      assertEquals(
        buildVeryfrontModuleUrl("components/Button.tsx"),
        "/_vf_modules/_veryfront/components/Button.js",
      );
    });

    it("should keep .js as-is", () => {
      assertEquals(buildVeryfrontModuleUrl("lib/main.js"), "/_vf_modules/_veryfront/lib/main.js");
    });
  });

  describe("normalizeExtension", () => {
    it("should convert .tsx to .js", () => {
      assertEquals(normalizeExtension("file.tsx"), "file.js");
    });

    it("should convert .ts to .js", () => {
      assertEquals(normalizeExtension("file.ts"), "file.js");
    });

    it("should convert .jsx to .js", () => {
      assertEquals(normalizeExtension("file.jsx"), "file.js");
    });

    it("should convert .mdx to .js", () => {
      assertEquals(normalizeExtension("file.mdx"), "file.js");
    });

    it("should remove extension when option set", () => {
      assertEquals(normalizeExtension("file.tsx", { removeExtension: true }), "file");
    });

    it("should keep .js unchanged", () => {
      assertEquals(normalizeExtension("file.js"), "file.js");
    });
  });

  describe("isEsmShUrl", () => {
    it("should return true for https esm.sh URLs", () => {
      assertEquals(isEsmShUrl("https://esm.sh/react"), true);
    });

    it("should return true for http esm.sh URLs", () => {
      assertEquals(isEsmShUrl("http://esm.sh/lodash"), true);
    });

    it("should return false for other URLs", () => {
      assertEquals(isEsmShUrl("https://cdn.example.com/lib.js"), false);
    });

    it("should return false for non-URLs", () => {
      assertEquals(isEsmShUrl("react"), false);
    });
  });

  describe("addEsmShDeps", () => {
    it("should add deps to esm.sh URL without params", () => {
      // Uses deps= to pin React version (not external= which causes bare imports)
      assertEquals(
        addEsmShDeps("https://esm.sh/lodash", "19.1.1"),
        "https://esm.sh/lodash?deps=react@19.1.1,react-dom@19.1.1&target=es2022",
      );
    });

    it("should skip non-esm.sh URLs", () => {
      assertEquals(addEsmShDeps("https://cdn.com/lib.js", "19.1.1"), "https://cdn.com/lib.js");
    });

    it("should skip React packages", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/react@19.1.1", "19.1.1"),
        "https://esm.sh/react@19.1.1",
      );
    });

    it("should skip URLs with existing query params", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/lodash?target=es2022", "19.1.1"),
        "https://esm.sh/lodash?target=es2022",
      );
    });
  });
});
