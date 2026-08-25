import "#veryfront/schemas/_test-setup.ts";
/**
 * Hydration parity tests for unified import rewriter.
 *
 * These tests verify that SSR and browser transforms produce compatible output,
 * preventing hydration mismatches caused by different import resolutions.
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { type RewriteContext, rewriteImports } from "../index.ts";
import { CSSTYPE_VERSION, DEFAULT_REACT_VERSION } from "../url-builder.ts";

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

      // Compare every emitted esm.sh URL, not just the first: a divergence in
      // any single React entry (react/jsx-runtime especially) is a dual-React
      // hydration break.
      const esmShUrlPattern = /https:\/\/esm\.sh\/[^"']+/g;
      const ssrReactUrls = [...ssrResult.matchAll(esmShUrlPattern)].map((match) => match[0]);
      const browserReactUrls = [...browserResult.matchAll(esmShUrlPattern)].map(
        (match) => match[0],
      );

      expect(ssrReactUrls).toEqual([
        `https://esm.sh/react@${DEFAULT_REACT_VERSION}?target=es2022&deps=csstype@${CSSTYPE_VERSION}`,
        `https://esm.sh/react@${DEFAULT_REACT_VERSION}?target=es2022&deps=csstype@${CSSTYPE_VERSION}`,
        `https://esm.sh/react@${DEFAULT_REACT_VERSION}/jsx-runtime?external=react&target=es2022&deps=csstype@${CSSTYPE_VERSION}`,
      ]);
      expect(browserReactUrls).toEqual(ssrReactUrls);
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

    it("keeps every browser child-module edge on the captured snapshot", async () => {
      const code = [
        `import RelativeChild from "./RelativeChild.js";`,
        `import AliasChild from "@/components/AliasChild";`,
        `import { Head } from "veryfront/head";`,
        `import RemoteChild from "shared@1.0.0/@/components/RemoteChild";`,
        `import { AsyncLocalStorage } from "node:async_hooks";`,
        `import "./RelativeSideEffect.js";`,
        `const AliasDynamic = import("@/components/AliasDynamic");`,
      ].join("\n");

      const result = await rewriteImports(
        code,
        createContext({
          target: "browser",
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );

      expect(result).toContain("./RelativeChild.js");
      expect(result).toContain("../components/AliasChild.js");
      expect(result).toContain(
        "/_vf_modules/_pins/on%3Asnapshot-a/_veryfront/react/runtime/core.js",
      );
      expect(result).toContain(
        "/_vf_modules/_pins/on%3Asnapshot-a/_cross/shared@1.0.0/@/components/RemoteChild.tsx",
      );
      expect(result).toContain(
        "/_vf_modules/_pins/on%3Asnapshot-a/_veryfront/platform/polyfills/node-async-hooks.js",
      );
      expect(result).toContain("./RelativeSideEffect.js");
      expect(result).toContain("../components/AliasDynamic.js");
      expect(result).not.toContain("pins=");
    });

    it("path-binds literal and computed browser module imports without changing options", async () => {
      const code = [
        `import AbsoluteChild from "https://app.example/_vf_modules/components/Absolute.js?pins=on%3Astale#entry";`,
        `import ProtocolChild from "//app.example/_vf_modules/components/Protocol.js";`,
        `import ForeignChild from "https://cdn.example.com/_vf_modules/components/Foreign.js";`,
        `const relativePath = "./RelativeLazy.js";`,
        `const rootPath = "/_vf_modules/components/RootLazy.js?pins=on%3Astale";`,
        `const barePath = "feature-package";`,
        `const remotePath = "https://cdn.example.com/remote.js";`,
        `const nonStringPath = { toString() { throw new Error("native coercion"); } };`,
        `export const relative = () => import(relativePath);`,
        `export const root = () => import(rootPath, { with: { type: "json" } });`,
        `export const bare = () => import(barePath);`,
        `export const remote = () => import(remotePath);`,
        `export const nonString = () => import(nonStringPath);`,
        `export const literal = () => import("/_vf_modules/components/Literal.js");`,
        `export const absoluteLiteral = () => import("https://app.example/_vf_modules/components/AbsoluteLazy.js");`,
        `export const protocolLiteral = () => import("//app.example/_vf_modules/components/ProtocolLazy.js");`,
        `export { AbsoluteChild, ProtocolChild, ForeignChild };`,
      ].join("\n");
      const context = createContext({
        target: "browser",
        filePath: "/project/components/Parent.ts",
        moduleServerOrigin: "https://app.example",
        dependencyPinningCacheKey: "on:snapshot-a",
      });

      const result = await rewriteImports(code, context);
      expect(result).toContain(
        `import("/_vf_modules/_pins/on%3Asnapshot-a/components/Literal.js")`,
      );
      expect(result).toContain(
        `from "/_vf_modules/_pins/on%3Asnapshot-a/components/Absolute.js#entry"`,
      );
      expect(result).toContain(
        `from "/_vf_modules/_pins/on%3Asnapshot-a/components/Protocol.js"`,
      );
      expect(result).toContain(
        `import("/_vf_modules/_pins/on%3Asnapshot-a/components/AbsoluteLazy.js")`,
      );
      expect(result).toContain(
        `import("/_vf_modules/_pins/on%3Asnapshot-a/components/ProtocolLazy.js")`,
      );
      expect(result).toContain(
        `from "https://cdn.example.com/_vf_modules/components/Foreign.js"`,
      );
      expect(result).toContain("/*__vf_dependency_pinned__*/");
      expect(result).toContain(`, { with: { type: "json" } })`);

      const helperMatch = result.match(
        /\n(function (__veryfrontPinDynamicImport_*)[\s\S]+)\n$/,
      );
      expect(helperMatch).not.toBeNull();
      const helper = new Function(
        `${helperMatch?.[1]}; return ${helperMatch?.[2]};`,
      )() as (value: unknown, parentUrl: string, modulePath?: string) => unknown;
      const parentUrl =
        "https://app.example/_vf_modules/_pins/on%3Asnapshot-a/components/Parent.js";
      const modulePath = "/_vf_modules/_pins/on%3Asnapshot-a/components/Parent.js";

      expect(helper("./RelativeLazy.js", parentUrl, modulePath)).toBe(
        "/_vf_modules/_pins/on%3Asnapshot-a/components/RelativeLazy.js",
      );
      expect(
        helper(
          "/_vf_modules/components/RootLazy.js?pins=on%3Astale#entry",
          parentUrl,
          modulePath,
        ),
      ).toBe(
        "/_vf_modules/_pins/on%3Asnapshot-a/components/RootLazy.js#entry",
      );
      expect(
        helper(
          "HTTPS://app.example/_vf_modules/components/Uppercase.js",
          parentUrl,
          modulePath,
        ),
      ).toBe(
        "/_vf_modules/_pins/on%3Asnapshot-a/components/Uppercase.js",
      );
      expect(helper("feature-package", parentUrl, modulePath)).toBe("feature-package");
      expect(helper("https://cdn.example.com/remote.js", parentUrl, modulePath)).toBe(
        "https://cdn.example.com/remote.js",
      );
      const nonString = {
        toString(): string {
          throw new Error("native coercion");
        },
      };
      expect(helper(nonString, parentUrl, modulePath)).toBe(nonString);
      expect(
        helper("../../../Escape.js", parentUrl, modulePath),
      ).toBe("/_vf_modules/_pins/invalid");

      expect(await rewriteImports(result, context)).toBe(result);
    });

    it("keeps computed cross-project SSR children on the snapshot and SSR target", async () => {
      const code = [
        `import StaticAbsolute from "HTTPS://app.example/_vf_modules/shared/StaticAbsolute.js";`,
        `import StaticProtocol from "//app.example/_vf_modules/shared/StaticProtocol.js";`,
        `import StaticForeign from "https://cdn.example/_vf_modules/shared/StaticForeign.js";`,
        `const relativePath = "./Relative.js";`,
        `const aliasPath = "@/shared/Alias.js";`,
        `const rootPath = "/_vf_modules/shared/Root.js";`,
        `const absolutePath = "HTTPS://app.example/_vf_modules/shared/Absolute.js";`,
        `const protocolPath = "//app.example/_vf_modules/shared/Protocol.js";`,
        `const foreignPath = "https://cdn.example/_vf_modules/shared/Foreign.js";`,
        `export const relative = () => import(relativePath);`,
        `export const alias = () => import(aliasPath);`,
        `export const root = () => import(rootPath);`,
        `export const absolute = () => import(absolutePath);`,
        `export const protocol = () => import(protocolPath);`,
        `export const foreign = () => import(foreignPath);`,
        `export { StaticAbsolute, StaticProtocol, StaticForeign };`,
      ].join("\n");
      const result = await rewriteImports(
        code,
        createContext({
          target: "ssr",
          filePath: "components/Parent.ts",
          moduleServerUrl: "/_vf_modules/_cross/remote@1.0.0/@",
          moduleServerOrigin: "https://app.example",
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );
      const helperMatch = result.match(
        /\n(function (__veryfrontPinDynamicImport_*)[\s\S]+)\n$/,
      );
      expect(result).toContain(
        `from "/_vf_modules/_pins/on%3Asnapshot-a/shared/StaticAbsolute.js?ssr=true"`,
      );
      expect(result).toContain(
        `from "/_vf_modules/_pins/on%3Asnapshot-a/shared/StaticProtocol.js?ssr=true"`,
      );
      expect(result).toContain(
        `from "https://cdn.example/_vf_modules/shared/StaticForeign.js"`,
      );
      expect(helperMatch).not.toBeNull();
      const helper = new Function(
        `${helperMatch?.[1]}; return ${helperMatch?.[2]};`,
      )() as (value: unknown, parentUrl: string, modulePath?: string) => unknown;
      const parentUrl =
        "https://app.example/_vf_modules/_cross/remote@1.0.0/@/components/Parent.js?ssr=true&pins=on%3Asnapshot-a";
      const modulePath =
        "/_vf_modules/_pins/on%3Asnapshot-a/_cross/remote@1.0.0/@/components/Parent.js";

      expect(helper("./Relative.js", parentUrl, modulePath)).toBe(
        "/_vf_modules/_pins/on%3Asnapshot-a/_cross/remote@1.0.0/@/components/Relative.js?ssr=true",
      );
      expect(helper("@/shared/Alias.js", parentUrl, modulePath)).toBe(
        "/_vf_modules/_pins/on%3Asnapshot-a/_cross/remote@1.0.0/@/shared/Alias.js?ssr=true",
      );
      for (
        const [value, expected] of [
          [
            "/_vf_modules/shared/Root.js",
            "/_vf_modules/_pins/on%3Asnapshot-a/shared/Root.js?ssr=true",
          ],
          [
            "HTTPS://app.example/_vf_modules/shared/Absolute.js",
            "/_vf_modules/_pins/on%3Asnapshot-a/shared/Absolute.js?ssr=true",
          ],
          [
            "//app.example/_vf_modules/shared/Protocol.js",
            "/_vf_modules/_pins/on%3Asnapshot-a/shared/Protocol.js?ssr=true",
          ],
        ] as const
      ) {
        expect(helper(value, parentUrl, modulePath)).toBe(expected);
      }
      expect(
        helper(
          "https://cdn.example/_vf_modules/shared/Foreign.js",
          parentUrl,
          modulePath,
        ),
      ).toBe("https://cdn.example/_vf_modules/shared/Foreign.js");
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

    it("should canonicalize matching bare and malformed esm.sh package imports", async () => {
      const code = `
        import { QueryClient } from "https://esm.sh/@tanstack/react-query@5?external=react&react-dom";
        import { useQuery } from "@tanstack/react-query@5";
      `;

      const result = await rewriteImports(code, createContext({ target: "browser" }));
      const urls = [...result.matchAll(/https:\/\/esm\.sh\/@tanstack\/react-query@5\?[^"']+/g)]
        .map((match) => match[0]);

      expect(urls).toHaveLength(2);
      expect(new Set(urls)).toEqual(
        new Set(["https://esm.sh/@tanstack/react-query@5?external=react,react-dom&target=es2022"]),
      );
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
    it("should transform #veryfront/ to veryfront/ for SSR", async () => {
      const code = `import { something } from "#veryfront/utils";`;
      const result = await rewriteImports(code, createContext({ target: "ssr" }));
      expect(result).toContain("veryfront/utils");
    });

    it("should map veryfront/* to module server URLs for browser", async () => {
      const code = `import { Head } from "veryfront/head";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));
      expect(result).toContain("/_vf_modules/_veryfront/react/runtime/core.js");
      expect(result).not.toContain('"veryfront/head"');
    });

    it("should map all known veryfront subpaths for browser", async () => {
      const testCases = [
        { input: "veryfront/head", expected: "/_vf_modules/_veryfront/react/runtime/core.js" },
        { input: "veryfront/router", expected: "/_vf_modules/_veryfront/react/runtime/core.js" },
        { input: "veryfront/context", expected: "/_vf_modules/_veryfront/react/runtime/core.js" },
        { input: "veryfront/fonts", expected: "/_vf_modules/_veryfront/react/fonts/index.js" },
      ];

      for (const { input, expected } of testCases) {
        const code = `import { x } from "${input}";`;
        const result = await rewriteImports(code, createContext({ target: "browser" }));
        expect(result).toContain(expected);
      }
    });

    it("should map veryfront/* to module server URLs for browser", async () => {
      const code = `import { Head } from "veryfront/head";`;
      const result = await rewriteImports(code, createContext({ target: "browser" }));
      expect(result).toContain("/_vf_modules/_veryfront/react/runtime/core.js");
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
      expect(result).toContain("/_vf_modules/_veryfront/react/runtime/core.js");
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

    expect(blogResult).toContain("/_vf_modules/_veryfront/react/runtime/core.js");
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
    // SSR now rewrites #veryfront/* to /_vf_modules/ URLs with ?ssr=true
    // This allows ssrVfModulesPlugin to identify and resolve these imports
    expect(ssrResult).toContain("/_vf_modules/_veryfront/react/head-collector.js?ssr=true");
    expect(ssrResult).toContain("/_vf_modules/_veryfront/platform/compat/runtime.js?ssr=true");
  });
});
