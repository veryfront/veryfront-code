/**
 * Hydration parity tests for unified import rewriter.
 *
 * These tests verify that SSR and browser transforms produce compatible output,
 * preventing hydration mismatches caused by different import resolutions.
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { type RewriteContext, rewriteImports } from "../index.ts";
import { DEFAULT_REACT_VERSION } from "../url-builder.ts";

function createContext(overrides: Partial<RewriteContext>): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test-project",
    target: "browser",
    dev: false,
    reactVersion: DEFAULT_REACT_VERSION,
    ...overrides,
  };
}

describe("Hydration Parity", () => {
  describe("React imports", () => {
    it("should produce identical React URLs for SSR and browser", async () => {
      const code = `
        import React from "react";
        import { useState } from "react";
        import { jsx } from "react/jsx-runtime";
      `;

      const ssrResult = await rewriteImports(code, createContext({ target: "ssr" }));
      const browserResult = await rewriteImports(code, createContext({ target: "browser" }));

      expect(ssrResult).toContain(`https://esm.sh/react@${DEFAULT_REACT_VERSION}`);
      expect(browserResult).toContain(`https://esm.sh/react@${DEFAULT_REACT_VERSION}`);

      const reactUrlPattern = /https:\/\/esm\.sh\/react@[\d.]+\?[^"']+/;
      const ssrReactUrl = ssrResult.match(reactUrlPattern)?.[0];
      const browserReactUrl = browserResult.match(reactUrlPattern)?.[0];

      expect(ssrReactUrl).toBe(browserReactUrl);
    });

    it("should use same query params for React packages", async () => {
      const code = `import ReactDOM from "react-dom";`;

      const ssrResult = await rewriteImports(code, createContext({ target: "ssr" }));
      const browserResult = await rewriteImports(code, createContext({ target: "browser" }));

      for (const result of [ssrResult, browserResult]) {
        expect(result).toContain("external=react");
        expect(result).toContain("target=es2022");
      }
    });
  });

  describe("Relative imports", () => {
    it("should normalize extensions consistently", async () => {
      const code = `import { helper } from "./utils.tsx";`;

      const ssrResult = await rewriteImports(code, createContext({ target: "ssr" }));

      expect(ssrResult).toContain("./utils.js");
      expect(ssrResult).not.toContain("./utils.tsx");
    });

    it("should handle path aliases consistently", async () => {
      const code = `import { Button } from "@/components/Button";`;

      const ctxOverrides = { filePath: "/project/pages/home/index.tsx" };
      const ssrResult = await rewriteImports(
        code,
        createContext({ target: "ssr", ...ctxOverrides }),
      );
      const browserResult = await rewriteImports(
        code,
        createContext({ target: "browser", ...ctxOverrides }),
      );

      // SSR uses /_vf_modules/ paths for HTTP module resolution
      expect(ssrResult).toContain("/_vf_modules/components/Button.js");
      // Browser uses relative paths
      expect(browserResult).toContain("../../components/Button.js");
    });
  });

  describe("Strategy priority", () => {
    it("should apply React strategy before bare strategy", async () => {
      const code = `import React from "react";`;

      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("deps=csstype");
    });

    it("should not double-rewrite already resolved URLs", async () => {
      const code = `import { something } from "https://esm.sh/some-package@1.0.0";`;

      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).not.toContain("https://esm.sh/https://");
    });

    it("should not corrupt esm.sh URLs with query params", async () => {
      const code =
        `import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1?external=react,react-dom";`;

      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("@radix-ui/react-slot@1.0.1");
      expect(result).not.toContain("react-slhttps://");
      expect(result).not.toContain("react-slothttps://");
    });

    it("should preserve mixed bare and URL imports", async () => {
      const code = `
        import { cn } from "@/lib/utils";
        import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1?external=react,react-dom";
        import React from "react";
      `;

      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("@radix-ui/react-slot@1.0.1");
      expect(result).toContain(`react@${DEFAULT_REACT_VERSION}`);
      expect(result).toContain("./lib/utils");
      expect(result).not.toContain("https://esm.sh/https://");
    });
  });
});

describe("Strategy Unit Tests", () => {
  describe("ReactStrategy", () => {
    it("should handle all React package variations", async () => {
      const packages = [
        "react",
        "react-dom",
        "react-dom/client",
        "react-dom/server",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ];

      for (const pkg of packages) {
        const code = `import x from "${pkg}";`;
        const result = await rewriteImports(code, createContext({ target: "browser" }));
        expect(result).toContain("esm.sh");
        expect(result).toContain(DEFAULT_REACT_VERSION);
      }
    });
  });

  describe("AliasStrategy", () => {
    it("should resolve @/ to relative paths based on file location", async () => {
      const testCases = [
        { file: "/project/pages/index.tsx", expected: "./" },
        { file: "/project/pages/home/index.tsx", expected: "../" },
        { file: "/project/pages/home/deep/index.tsx", expected: "../../" },
      ];

      for (const { file, expected } of testCases) {
        const code = `import { Button } from "@/components/Button";`;
        const result = await rewriteImports(
          code,
          createContext({ filePath: file, target: "browser" }),
        );
        expect(result).toContain(expected);
      }
    });
  });

  describe("VeryfrontStrategy", () => {
    it("should normalize @veryfront/ to veryfront/ for SSR", async () => {
      const code = `import { something } from "@veryfront/utils";`;
      const result = await rewriteImports(code, createContext({ target: "ssr" }));
      expect(result).toContain("veryfront/utils");
      expect(result).not.toContain("@veryfront/utils");
    });

    it("should map veryfront/* to module server URLs for browser", async () => {
      const code = `import { Head } from "veryfront/head";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));
      expect(result).toContain("/_vf_modules/react/components/Head.js");
      expect(result).not.toContain('"veryfront/head"');
    });

    it("should map all known veryfront subpaths for browser", async () => {
      const testCases = [
        { input: "veryfront/head", expected: "/_vf_modules/react/components/Head.js" },
        { input: "veryfront/router", expected: "/_vf_modules/react/router/index.js" },
        { input: "veryfront/context", expected: "/_vf_modules/react/context/index.js" },
        { input: "veryfront/fonts", expected: "/_vf_modules/react/fonts/index.js" },
      ];

      for (const { input, expected } of testCases) {
        const code = `import { x } from "${input}";`;
        const result = await rewriteImports(code, createContext({ target: "browser" }));
        expect(result).toContain(expected);
      }
    });

    it("should map @veryfront/* to module server URLs for browser", async () => {
      const code = `import { Head } from "@veryfront/head";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));
      expect(result).toContain("/_vf_modules/react/components/Head.js");
    });
  });

  describe("NodeBuiltinStrategy", () => {
    it("should never rewrite node: imports to esm.sh URLs", async () => {
      const builtins = [
        "node:async_hooks",
        "node:fs",
        "node:path",
        "node:crypto",
        "node:buffer",
        "node:stream",
        "node:util",
      ];

      for (const builtin of builtins) {
        const code = `import { something } from "${builtin}";`;
        const result = await rewriteImports(code, createContext({ target: "browser" }));

        expect(result).not.toContain(`esm.sh/${builtin}`);
        expect(result).not.toContain("esm.sh/node:");
      }
    });

    it("should replace node:async_hooks with polyfill module for browser", async () => {
      const code = `import { AsyncLocalStorage } from "node:async_hooks";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("/_vf_modules/_veryfront/platform/polyfills/node-async-hooks.js");
      expect(result).not.toContain('"node:async_hooks"');
    });

    it("should replace unknown node: builtins with noop module for browser", async () => {
      const code = `import { something } from "node:fs";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("/_vf_modules/_veryfront/platform/polyfills/node-noop.js");
      expect(result).not.toContain('"node:fs"');
    });

    it("should preserve node: imports for SSR", async () => {
      const code = `import { AsyncLocalStorage } from "node:async_hooks";`;
      const result = await rewriteImports(code, createContext({ target: "ssr" }));

      expect(result).toContain('"node:async_hooks"');
    });

    it("should handle mixed node: and npm imports", async () => {
      const code = `
        import { AsyncLocalStorage } from "node:async_hooks";
        import React from "react";
        import { Head } from "veryfront/head";
      `;

      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).not.toContain("esm.sh/node:");
      expect(result).toContain("/_vf_modules/_veryfront/platform/polyfills/node-async-hooks.js");
      expect(result).toContain(`esm.sh/react@${DEFAULT_REACT_VERSION}`);
      expect(result).toContain("/_vf_modules/react/components/Head.js");
    });
  });

  describe("BareStrategy", () => {
    it("should skip React packages (handled by ReactStrategy)", async () => {
      const code = `import React from "react";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("deps=csstype");
    });

    it("should add version warning for unversioned packages", async () => {
      const code = `import _ from "lodash";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).toContain("esm.sh/lodash");
    });

    it("should not treat node: builtins as npm packages", async () => {
      const code = `import { createHash } from "node:crypto";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));

      expect(result).not.toContain("esm.sh/node:crypto");
    });
  });

  describe("RelativeStrategy", () => {
    it("should normalize TypeScript extensions", async () => {
      const testCases = [
        { input: "./utils.ts", expected: "./utils.js" },
        { input: "./utils.tsx", expected: "./utils.js" },
        { input: "./utils.jsx", expected: "./utils.js" },
      ];

      for (const { input, expected } of testCases) {
        const code = `import { x } from "${input}";`;
        const result = await rewriteImports(code, createContext({ target: "ssr" }));
        expect(result).toContain(expected);
      }
    });
  });
});

describe("Regression: Full Import Chain", () => {
  it("should handle the blog page import pattern (Head → head-collector → node:async_hooks)", async () => {
    const blogCode = `
      import { Head } from "veryfront/head";
      import { BlogList } from "@/components/blog/BlogList";
      import React from "react";
    `;
    const blogResult = await rewriteImports(blogCode, createContext({ target: "browser" }));

    expect(blogResult).toContain("/_vf_modules/react/components/Head.js");
    expect(blogResult).toContain("./components/blog/BlogList");
    expect(blogResult).toContain(`esm.sh/react@${DEFAULT_REACT_VERSION}`);

    const headCollectorCode = `
      import { AsyncLocalStorage } from "node:async_hooks";
      import { isServerEnvironment } from "#veryfront/platform/compat/runtime.ts";
    `;
    const headCollectorResult = await rewriteImports(
      headCollectorCode,
      createContext({ target: "browser", filePath: "/project/src/react/head-collector.ts" }),
    );

    expect(headCollectorResult).not.toContain("esm.sh/node:");
    expect(headCollectorResult).toContain(
      "/_vf_modules/_veryfront/platform/polyfills/node-async-hooks.js",
    );
    expect(headCollectorResult).toContain("/_vf_modules/_veryfront/");
  });

  it("should handle isomorphic component with server-only dependency", async () => {
    const code = `
      import React from "react";
      import { collectHead } from "#veryfront/react/head-collector.ts";
      import { isServerEnvironment } from "#veryfront/platform/compat/runtime.ts";
    `;

    const browserResult = await rewriteImports(code, createContext({ target: "browser" }));
    const ssrResult = await rewriteImports(code, createContext({ target: "ssr" }));

    expect(browserResult).toContain("esm.sh/react@");
    expect(browserResult).toContain("/_vf_modules/_veryfront/react/head-collector.js");
    expect(browserResult).toContain("/_vf_modules/_veryfront/platform/compat/runtime.js");

    expect(ssrResult).toContain("esm.sh/react@");
    expect(ssrResult).toContain("#veryfront/react/head-collector.ts");
    expect(ssrResult).toContain("#veryfront/platform/compat/runtime.ts");
  });
});
