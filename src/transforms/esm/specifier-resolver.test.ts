import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheHttpModuleFn } from "./specifier-resolver.ts";
import { buildReplacements, rewriteModuleImports } from "./specifier-resolver.ts";
import type { CacheOptions } from "./http-cache-helpers.ts";
import {
  fingerprintHttpModuleRequest,
  getEffectiveHttpCacheRequest,
  normalizeHttpUrl,
} from "./http-cache-helpers.ts";
import { BUILD_FAILED, VeryfrontError } from "#veryfront/errors";
import { OutboundRequestBlockedError } from "#veryfront/security/http/outbound-fetch.ts";
import { aliasStrategy } from "#veryfront/transforms/import-rewriter/strategies/alias-strategy.ts";

describe("transforms/esm/specifier-resolver", () => {
  const defaultOptions: CacheOptions = {
    cacheDir: "/tmp/cache",
    importMap: { imports: {} },
  };

  const noopCache: CacheHttpModuleFn = async () => null;

  describe("buildReplacements", () => {
    it("returns empty map for code with no imports", async () => {
      const result = await buildReplacements("const x = 1;", undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("returns empty map for internal bare specifiers", async () => {
      const code = `import { foo } from "#veryfront/utils";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("returns empty map for node: scheme", async () => {
      const code = `import fs from "node:fs";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("does not rewrite private import-map aliases to esm.sh fragments", async () => {
      const code = `import { load } from "#std/dotenv.ts";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        "https://esm.sh/?external=react&target=es2022",
        defaultOptions,
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-std.mjs";
        },
      );

      assertEquals(result.replacements.size, 0);
      assertEquals(cacheCalls, []);
    });

    it("rewrites mapped private import-map aliases before skipping internal aliases", async () => {
      const code = `import pkg from "#pkg";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        "https://esm.sh/parent@1/index.js",
        {
          ...defaultOptions,
          importMap: {
            imports: {
              "#pkg": "https://cdn.example.com/pkg.js",
            },
          },
        },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-pkg.mjs";
        },
      );

      assertEquals(result.replacements.get("#pkg"), "./http-pkg.mjs");
      assertEquals(cacheCalls, ["https://cdn.example.com/pkg.js"]);
    });

    it("returns empty map for jsr: specifiers", async () => {
      const code = `import { load } from "jsr:@std/dotenv@0.225.6";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("rewrites npm: specifiers when cache returns a path", async () => {
      const code = `import React from "npm:react@18";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-12345.mjs";
      const result = await buildReplacements(code, undefined, defaultOptions, mockCache);
      assertEquals(result.replacements.has("npm:react@18"), true);
      assertEquals(result.replacements.get("npm:react@18"), "file:///tmp/cache/http-12345.mjs");
    });

    it("npm: specifier falls back to bare name when cache returns null", async () => {
      const code = `import React from "npm:react@18";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.get("npm:react@18"), "react@18");
    });

    it("resolves npm: specifiers after String prefix poisoning", async () => {
      const stringPrototypeDescriptors = Object.getOwnPropertyDescriptors(String.prototype);

      try {
        Object.defineProperty(String.prototype, "startsWith", {
          configurable: true,
          value() {
            throw new Error("poisoned String.prototype.startsWith");
          },
          writable: true,
        });

        const code = `import React from "npm:react@18";`;
        const result = await buildReplacements(code, undefined, defaultOptions, async () => {
          return "/tmp/cache/http-12345.mjs";
        });
        assertEquals(result.replacements.get("npm:react@18"), "file:///tmp/cache/http-12345.mjs");
      } finally {
        Object.defineProperties(String.prototype, stringPrototypeDescriptors);
      }
    });

    it("rewrites escaped project aliases without mutable search hooks", async () => {
      const stringPrototypeDescriptors = Object.getOwnPropertyDescriptors(String.prototype);
      const regexpSearch = Object.getOwnPropertyDescriptor(RegExp.prototype, Symbol.search)!;

      try {
        Object.defineProperty(String.prototype, "search", {
          configurable: true,
          value() {
            throw new Error("poisoned String.prototype.search");
          },
          writable: true,
        });
        Object.defineProperty(RegExp.prototype, Symbol.search, {
          configurable: true,
          value() {
            throw new Error("poisoned RegExp @@search");
          },
        });

        const result = await buildReplacements(
          `import Foo from "@/components/Foo.tsx?raw#hero";`,
          undefined,
          defaultOptions,
          noopCache,
        );

        assertEquals(
          result.replacements.get("@/components/Foo.tsx?raw#hero"),
          "/_vf_modules/components/Foo.js?raw#hero",
        );
      } finally {
        Object.defineProperties(String.prototype, stringPrototypeDescriptors);
        Object.defineProperty(RegExp.prototype, Symbol.search, regexpSearch);
      }
    });

    it("rewrites escaped project aliases without mutable regex test hooks", async () => {
      const regexpPrototypeDescriptors = Object.getOwnPropertyDescriptors(RegExp.prototype);

      try {
        Object.defineProperty(RegExp.prototype, "test", {
          configurable: true,
          value() {
            throw new Error("poisoned RegExp.prototype.test");
          },
          writable: true,
        });

        const result = await buildReplacements(
          `import Foo from "@/components/Foo.tsx?raw#hero";`,
          undefined,
          defaultOptions,
          noopCache,
        );

        assertEquals(
          result.replacements.get("@/components/Foo.tsx?raw#hero"),
          "/_vf_modules/components/Foo.js?raw#hero",
        );
      } finally {
        Object.defineProperties(RegExp.prototype, regexpPrototypeDescriptors);
      }
    });

    it("rewrites http URL when cache returns a path", async () => {
      const code = `import lodash from "https://esm.sh/lodash@4";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-99999.mjs";
      const result = await buildReplacements(code, undefined, defaultOptions, mockCache);
      assertEquals(result.replacements.has("https://esm.sh/lodash@4"), true);
      assertEquals(
        result.replacements.get("https://esm.sh/lodash@4"),
        "file:///tmp/cache/http-99999.mjs",
      );
    });

    it("uses the module-server origin when the HTTP parent URL is unusable", async () => {
      const specifier = "//cdn.example/child.js";
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        `export { value } from "${specifier}";`,
        "https://",
        { ...defaultOptions, moduleServerOrigin: "http://app.example" },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-child.mjs";
        },
      );

      // A foreign host must never inherit the plaintext scheme of a
      // local-dev module-server origin.
      assertEquals(cacheCalls, ["https://cdn.example/child.js"]);
      assertEquals(result.replacements.get(specifier), "./http-child.mjs");
    });

    it("fails closed when a protocol-relative specifier has no resolvable base", async () => {
      await assertRejects(
        () =>
          buildReplacements(
            `import x from "//cdn.example/child.js";`,
            undefined,
            defaultOptions,
            noopCache,
          ),
        Error,
        "Cannot resolve protocol-relative HTTP module //cdn.example/child.js",
        "an unresolvable protocol-relative specifier must fail closed, never be emitted unrewritten",
      );
    });

    it("keeps the module server's own scheme for same-origin protocol-relative imports", async () => {
      const specifier = "//app.example/child.js";
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        `export { value } from "${specifier}";`,
        undefined,
        { ...defaultOptions, moduleServerOrigin: "http://app.example" },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-child.mjs";
        },
      );

      assertEquals(cacheCalls, ["http://app.example/child.js"]);
      assertEquals(result.replacements.get(specifier), "file:///tmp/cache/http-child.mjs");
    });

    it("rewrites mapped esm.sh veryfront URLs to local framework modules without caching", async () => {
      const specifier = "https://esm.sh/veryfront@0.1.759/chat";
      const code = `import { Chat } from "${specifier}";`;
      const cacheCalls: string[] = [];

      const result = await buildReplacements(
        code,
        undefined,
        {
          ...defaultOptions,
          importMap: {
            imports: {
              "veryfront/chat": "/_vf_modules/_veryfront/chat/index.js?ssr=true",
            },
          },
        },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-veryfront.mjs";
        },
      );

      assertEquals(
        result.replacements.get(specifier),
        "/_vf_modules/_veryfront/chat/index.js?ssr=true",
      );
      assertEquals(cacheCalls, []);
    });

    it("rewrites @/ alias imports to the project-module form without fetching", async () => {
      // The "@/" project alias is framework-supported (the default import map
      // maps "@/" -> "/_vf_modules/"). If one escapes the MDX loader's alias
      // rewrite and reaches this resolver, it must land on the project-module
      // transport, never on esm.sh as a bogus scoped package.
      const code = `import ResponsiveImage from "@/components/ResponsiveImage";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(code, undefined, defaultOptions, async (url) => {
        cacheCalls.push(url);
        return "/tmp/cache/http-alias.mjs";
      });

      assertEquals(cacheCalls, []);
      assertEquals(
        result.replacements.get("@/components/ResponsiveImage"),
        "/_vf_modules/components/ResponsiveImage.js",
      );
    });

    it("preserves safe configured @/ module prefix mappings", async () => {
      const code = `import ResponsiveImage from "@/components/ResponsiveImage";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        undefined,
        { ...defaultOptions, importMap: { imports: { "@/": "/_vf_modules/custom-root/" } } },
        async (url) => {
          cacheCalls.push(url);
          return "/_vf_modules/unexpected-http-alias.mjs";
        },
      );

      assertEquals(cacheCalls, []);
      assertEquals(
        result.replacements.get("@/components/ResponsiveImage"),
        "/_vf_modules/custom-root/components/ResponsiveImage",
      );
    });

    it("materializes escaped @/ alias imports when a module-server origin is available", async () => {
      const code = `import ResponsiveImage from "@/components/ResponsiveImage";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        undefined,
        { ...defaultOptions, moduleServerOrigin: "https://preview.example" },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-alias.mjs";
        },
      );

      assertEquals(cacheCalls, [
        "https://preview.example/_vf_modules/components/ResponsiveImage.js",
      ]);
      assertEquals(
        result.replacements.get("@/components/ResponsiveImage"),
        "file:///tmp/cache/http-alias.mjs",
      );
    });

    it("normalizes explicit source extensions in escaped @/ alias imports", async () => {
      const code = `import Card from "@/components/Card.tsx";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(code, undefined, defaultOptions, async (url) => {
        cacheCalls.push(url);
        return "/tmp/cache/http-alias.mjs";
      });

      assertEquals(cacheCalls, []);
      assertEquals(
        result.replacements.get("@/components/Card.tsx"),
        "/_vf_modules/components/Card.js",
      );
    });

    it("preserves query and fragment suffixes in escaped @/ alias imports", async () => {
      const code =
        `import raw from "@/components/Card.tsx?raw"; import icon from "@/components/Icon.svg#glyph";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(code, undefined, defaultOptions, async (url) => {
        cacheCalls.push(url);
        return "/tmp/cache/http-alias.mjs";
      });

      assertEquals(cacheCalls, []);
      assertEquals(
        result.replacements.get("@/components/Card.tsx?raw"),
        "/_vf_modules/components/Card.js?raw",
      );
      assertEquals(
        result.replacements.get("@/components/Icon.svg#glyph"),
        "/_vf_modules/components/Icon.svg.js#glyph",
      );
    });

    it("rejects @/ alias imports whose dot segments escape the module transport", async () => {
      // URL resolution removes dot segments, so without containment an
      // authored "@/../_veryfront/modules/foo" would resolve to
      // https://<origin>/_veryfront/modules/foo — outside `/_vf_modules/` —
      // and the resolver would fetch and cache an arbitrary same-origin path
      // as an executable module.
      const code = `import escape from "@/../_veryfront/modules/foo";`;
      const cacheCalls: string[] = [];
      await assertRejects(
        () =>
          buildReplacements(
            code,
            undefined,
            { ...defaultOptions, moduleServerOrigin: "https://preview.example" },
            async (url) => {
              cacheCalls.push(url);
              return "/tmp/cache/http-alias.mjs";
            },
          ),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
      assertEquals(cacheCalls, []);
    });

    it("rejects percent-encoded dot segments in @/ alias imports", async () => {
      // WHATWG URL parsing also collapses "%2e%2e" dot segments, so the
      // encoded form must be refused before the path reaches URL resolution.
      const code = `import escape from "@/%2e%2e/_veryfront/modules/foo";`;
      const cacheCalls: string[] = [];
      await assertRejects(
        () =>
          buildReplacements(
            code,
            undefined,
            { ...defaultOptions, moduleServerOrigin: "https://preview.example" },
            async (url) => {
              cacheCalls.push(url);
              return "/tmp/cache/http-alias.mjs";
            },
          ),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
      assertEquals(cacheCalls, []);
    });

    it("rejects backslash traversal in @/ alias imports", async () => {
      // Special-scheme URL parsing treats "\" as "/", so "..\\" is a dot
      // segment too.
      const code = `import escape from "@/..\\\\_veryfront/modules/foo";`;
      await assertRejects(
        () => buildReplacements(code, undefined, defaultOptions, noopCache),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
    });

    it("rejects dot-segment @/ aliases even without a module-server origin", async () => {
      // Without an origin the composed "/_vf_modules/../..." path is returned
      // verbatim and the importing runtime collapses the dot segments instead,
      // so the origin-less branch must fail closed too.
      const code = `import escape from "@/../_veryfront/modules/foo";`;
      await assertRejects(
        () => buildReplacements(code, undefined, defaultOptions, noopCache),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
    });

    it("rejects URL-stripped whitespace between dot segments in @/ aliases", async () => {
      // The WHATWG URL parser removes TAB, CR and LF *before* it collapses dot
      // segments, so "..<TAB>/" reaches the importing runtime as ".." and
      // escapes the transport even though the authored text matches no
      // dot-segment pattern. The origin-less branch returns the composed path
      // verbatim, so it is the one that must fail closed here.
      for (const separator of ["\t", "\r", "\n"]) {
        const specifier = `@/..${separator}/_veryfront/modules/foo`;
        const code = `import escape from ${JSON.stringify(specifier)};`;
        await assertRejects(
          () => buildReplacements(code, undefined, defaultOptions, noopCache),
          Error,
          "escapes the /_vf_modules/ module transport",
          `@/..<U+${separator.charCodeAt(0).toString(16).padStart(4, "0")}>/… must fail closed`,
        );
      }
    });

    it("rejects import-map @/ targets that normalize out of the module transport", async () => {
      // The configured target keeps the "/_vf_modules/" prefix, so a prefix
      // test accepts it, but the browser normalizes the emitted specifier to
      // "/_veryfront/modules/foo" — an arbitrary same-origin path cached as an
      // executable module.
      const code = `import escape from "@/foo";`;
      const cacheCalls: string[] = [];
      await assertRejects(
        () =>
          buildReplacements(
            code,
            undefined,
            {
              ...defaultOptions,
              importMap: { imports: { "@/": "/_vf_modules/../_veryfront/modules/" } },
            },
            async (url) => {
              cacheCalls.push(url);
              return "/tmp/cache/http-alias.mjs";
            },
          ),
        Error,
        "resolves outside the /_vf_modules/ module transport",
      );
      assertEquals(cacheCalls, []);
    });

    it("omits the authored query and fragment from @/ alias rejection messages", async () => {
      // A rejected alias may carry credentials in its query or fragment, and
      // AGENTS.md forbids echoing those into error messages.
      const secretSuffix = "?token=EXAMPLE-CREDENTIAL-VALUE#EXAMPLE-FRAGMENT";
      const code = `import escape from "@/../_veryfront/modules/foo${secretSuffix}";`;
      const error = await assertRejects(
        () => buildReplacements(code, undefined, defaultOptions, noopCache),
        Error,
        "escapes the /_vf_modules/ module transport",
      );

      assertEquals(
        error.message.includes("EXAMPLE-CREDENTIAL-VALUE"),
        false,
        "the authored query string must never reach the error message",
      );
      assertEquals(
        error.message.includes("EXAMPLE-FRAGMENT"),
        false,
        "the authored fragment must never reach the error message",
      );
    });

    it("rejects dot-segment @/ aliases before configured prefix mappings apply", async () => {
      // A configured "@/" -> "/_vf_modules/" prefix mapping would otherwise
      // emit "/_vf_modules/../..." as a local specifier and hand the escape to
      // the importing runtime.
      const code = `import escape from "@/../_veryfront/modules/foo";`;
      await assertRejects(
        () =>
          buildReplacements(
            code,
            undefined,
            { ...defaultOptions, importMap: { imports: { "@/": "/_vf_modules/" } } },
            noopCache,
          ),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
    });

    // The URL shape is not chosen here. `AliasStrategy` is the framework's
    // canonical "@/" rewriter and emits this exact shape for both its `ssr` and
    // its browser target, so this resolver — a late fallback for an alias that
    // escaped every earlier rewrite — must agree with it byte for byte or one
    // specifier resolves to two different module URLs.
    it("matches AliasStrategy for every extension class", async () => {
      const paths = [
        "components/ResponsiveImage",
        "components/Card.tsx",
        "components/Card.ts",
        "components/Card.jsx",
        "post.mdx",
        "post.md",
        "lib/data.json",
        "components/Icon.svg",
        "styles/globals.css",
        "vendor/bundle.mjs",
        "vendor/bundle.cjs",
        "vendor/bundle.js",
      ];

      const code = paths.map((path, index) => `import m${index} from "@/${path}";`).join("\n");
      const result = await buildReplacements(code, undefined, defaultOptions, async () => {
        throw new Error("an @/ alias must never be fetched");
      });

      for (const path of paths) {
        const expected = aliasStrategy.rewrite(
          { specifier: `@/${path}` } as Parameters<typeof aliasStrategy.rewrite>[0],
          { target: "ssr" } as Parameters<typeof aliasStrategy.rewrite>[1],
        ).specifier;

        assertEquals(result.replacements.get(`@/${path}`), expected, `@/${path}`);
      }
    });

    // `.json` and `.md` reach the module server as `<path>.<ext>.js`, which it
    // strips before source lookup (`module-server.ts` `filePathWithoutExt`), so
    // the doubled extension resolves to the real file. `.svg` and `.css` are not
    // servable through `/_vf_modules/` with or without the `.js`, so appending
    // it costs nothing.
    it("appends .js to non-JS source extensions and passes JS-like ones through", async () => {
      const expectations: ReadonlyArray<readonly [string, string]> = [
        ["@/lib/data.json", "/_vf_modules/lib/data.json.js"],
        ["@/post.md", "/_vf_modules/post.md.js"],
        ["@/post.mdx", "/_vf_modules/post.js"],
        ["@/components/Icon.svg", "/_vf_modules/components/Icon.svg.js"],
        ["@/components/Button", "/_vf_modules/components/Button.js"],
        ["@/styles/globals.css", "/_vf_modules/styles/globals.css"],
        ["@/vendor/bundle.mjs", "/_vf_modules/vendor/bundle.mjs"],
        ["@/vendor/bundle.cjs", "/_vf_modules/vendor/bundle.cjs"],
      ];

      const code = expectations
        .map(([specifier], index) => `import m${index} from "${specifier}";`)
        .join("\n");
      const result = await buildReplacements(code, undefined, defaultOptions, async () => {
        throw new Error("an @/ alias must never be fetched");
      });

      for (const [specifier, expected] of expectations) {
        assertEquals(result.replacements.get(specifier), expected, specifier);
      }
    });

    it("never resolves an @/ alias against the page origin via an import-map prefix", async () => {
      // A project import map commonly maps "@/" to "./". Resolving that mapped
      // relative path against the page origin fetches the tenant's own public
      // site, which answers with HTML (VERYFRONT-SERVER-G).
      const code = `import ResponsiveImage from "@/components/ResponsiveImage";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        "https://responsive-image.example.com/foo",
        { ...defaultOptions, importMap: { imports: { "@/": "./" } } },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-origin.mjs";
        },
      );

      assertEquals(cacheCalls, []);
      assertEquals(
        result.replacements.get("@/components/ResponsiveImage"),
        "/_vf_modules/components/ResponsiveImage.js",
      );
    });

    it("uses relative path when parent is an HTTP module", async () => {
      const code = `import lodash from "https://esm.sh/lodash@4";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-99999.mjs";
      const result = await buildReplacements(
        code,
        "https://esm.sh/parent@1",
        defaultOptions,
        mockCache,
      );
      assertEquals(result.replacements.get("https://esm.sh/lodash@4"), "./http-99999.mjs");
    });

    it("resolves relative specifiers against HTTP base URL", async () => {
      const code = `import { foo } from "./utils.js";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-11111.mjs";
      const result = await buildReplacements(
        code,
        "https://esm.sh/my-lib@1/index.js",
        defaultOptions,
        mockCache,
      );
      assertEquals(result.replacements.has("./utils.js"), true);
      assertEquals(result.replacements.get("./utils.js"), "./http-11111.mjs");
    });

    it("ignores relative specifiers without HTTP base URL", async () => {
      const code = `import { foo } from "./utils.js";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("fails closed when a dynamic absolute URL cannot be cached", async () => {
      const code = `export const load = () => import("https://esm.sh/foo");`;
      await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("aborts when a static specifier's cache lookup throws", async () => {
      // A static import belongs to the emitted module's own import graph. The
      // artifact contract is that every static dependency is local before the
      // runtime loader sees it, so this failure stays fatal.
      const code = `import foo from "https://esm.sh/foo";`;
      await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("classifies a 404 on the authored package itself as a tenant build failure", async () => {
      const code = `import x from "some-package";`;
      const error = await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async (url, cacheOptions) => {
            const effective = getEffectiveHttpCacheRequest(url, cacheOptions);
            throw BUILD_FAILED.create({
              detail: "not found",
              context: {
                httpStatus: 404,
                httpModuleRequestFingerprint: await fingerprintHttpModuleRequest(
                  normalizeHttpUrl(effective.url),
                ),
              },
            });
          }),
        VeryfrontError,
      );

      assertEquals(
        ((error as VeryfrontError).context as
          | { tenantBuildFailure?: unknown }
          | undefined)?.tenantBuildFailure,
        true,
        "a 404 on the authored package itself is a tenant build failure",
      );
    });

    it("leaves a 404 on a transitive dependency classified as a platform failure", async () => {
      const code = `import x from "some-package";`;
      let thrown: unknown;
      const error = await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            thrown = BUILD_FAILED.create({
              detail: "not found",
              context: {
                httpStatus: 404,
                httpModuleRequestFingerprint: "different-fingerprint",
              },
            });
            throw thrown;
          }),
        VeryfrontError,
      );

      assertStrictEquals(
        error,
        thrown,
        "a 404 whose fingerprint is not the authored package must propagate unchanged",
      );
      assertEquals(
        ((error as VeryfrontError).context as
          | { tenantBuildFailure?: unknown }
          | undefined)?.tenantBuildFailure,
        undefined,
        "a 404 on a transitive dependency stays a platform build failure",
      );
    });

    it("aborts when a specifier is imported both statically and dynamically", async () => {
      const code = `import foo from "https://esm.sh/foo";\nexport const again = () =>` +
        ` import("https://esm.sh/foo");`;
      await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("fails closed when an absolute URL cache returns no artifact", async () => {
      const code = `export const load = () => import("https://esm.sh/foo");`;
      await assertRejects(
        () => buildReplacements(code, undefined, defaultOptions, async () => null),
        Error,
        "Failed to cache absolute HTTP module",
      );
    });

    it("never degrades an outbound-policy denial into a runtime import", async () => {
      const code = `export const load = () => import("http://169.254.169.254/metadata");`;
      await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            throw new OutboundRequestBlockedError("internal destination blocked");
          }),
        OutboundRequestBlockedError,
        "internal destination blocked",
      );
    });

    it("returns the complete replacement set when every specifier resolves", async () => {
      const code = `import ok from "https://esm.sh/ok";`;
      const result = await buildReplacements(
        code,
        undefined,
        defaultOptions,
        async () => "/tmp/cache/http-ok.mjs",
      );
      assertEquals(result.replacements.size, 1);
    });

    it("aborts when a dynamic relative specifier fails to resolve", async () => {
      // A relative specifier inside an esm.sh bundle resolves at call time
      // against the local bundle cache directory, where the chunk was never
      // written. Leaving it in place would guarantee a runtime failure.
      const code = `export const load = () => import("./chunk-abc.mjs");`;
      await assertRejects(
        () =>
          buildReplacements(code, "https://esm.sh/parent@1/index.js", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("aborts when a dynamic npm: specifier fails to resolve", async () => {
      const code = `export const load = () => import("npm:some-package");`;
      await assertRejects(
        () =>
          buildReplacements(code, "https://esm.sh/parent@1/index.js", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("leaves a server-only package external instead of routing it to esm.sh", async () => {
      // `redis` and its explicit npm: form only run server-side. They must be
      // left in place for the runtime to resolve (node_modules / npm:), never
      // fetched from esm.sh, so the cache function is never called and nothing
      // is degraded or aborted.
      for (const specifier of ["redis", "npm:redis", "npm:redis@5.11.0"]) {
        const code = `export const load = () => import(${JSON.stringify(specifier)});`;
        let cacheCalls = 0;
        const result = await buildReplacements(
          code,
          "https://esm.sh/parent@1/index.js",
          defaultOptions,
          async () => {
            cacheCalls++;
            return null;
          },
        );
        assertEquals(cacheCalls, 0, `${specifier} must not hit esm.sh`);
        assertEquals(result.replacements.size, 0, `${specifier} must be left in place`);
      }
    });

    it("leaves configured server external packages out of the HTTP cache graph", async () => {
      const cases = [
        ["knex", 'export const load = () => import("knex");'],
        ["npm:knex@3.1.0", 'export const load = () => import("npm:knex@3.1.0");'],
        [
          "@prisma/client/runtime/library",
          'export const load = () => import("@prisma/client/runtime/library");',
        ],
      ] as const;

      for (const [specifier, code] of cases) {
        let cacheCalls = 0;
        const result = await buildReplacements(
          code,
          "https://esm.sh/parent@1/index.js",
          {
            ...defaultOptions,
            serverExternalPackages: ["knex", "@prisma/client"],
          },
          async () => {
            cacheCalls++;
            return null;
          },
        );

        assertEquals(cacheCalls, 0, `${specifier} must not hit esm.sh`);
        assertEquals(result.replacements.size, 0, `${specifier} must be left in place`);
      }
    });

    it("aborts when a dynamic bare specifier fails to resolve", async () => {
      const code = `export const load = () => import("some-package");`;
      await assertRejects(
        () =>
          buildReplacements(code, "https://esm.sh/parent@1/index.js", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("rejects the entire artifact when any dynamic absolute URL fails", async () => {
      const code = `import ok from "https://esm.sh/ok";\n` +
        `export const load = () => import("https://esm.sh/broken");`;
      const cache: CacheHttpModuleFn = async (url) => {
        if (url === "https://esm.sh/broken") throw new Error("upstream 500");
        return "/tmp/cache/http-ok.mjs";
      };
      await assertRejects(
        () => buildReplacements(code, undefined, defaultOptions, cache),
        Error,
        "upstream 500",
      );
    });
  });

  describe("rewriteModuleImports", () => {
    it("returns code unchanged when no replacements needed", async () => {
      const code = `import fs from "node:fs";`;
      const result = await rewriteModuleImports(code, "", defaultOptions, noopCache);
      assertEquals(result.code, code);
    });

    it("rewrites http import in code", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-12345.mjs";
      const result = await rewriteModuleImports(code, "", defaultOptions, mockCache);
      assertEquals(result.code.includes("file:///tmp/cache/http-12345.mjs"), true);
      assertEquals(result.code.includes("https://esm.sh/react@18"), false);
    });

    it("does not emit a dynamic absolute URL when caching throws", async () => {
      const original = `export const load = () => import("https://esm.sh/foo");`;
      await assertRejects(
        () =>
          rewriteModuleImports(original, "https://esm.sh/parent", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("does not emit a dynamic absolute URL when caching returns null", async () => {
      const original = `export const load = () => import("https://esm.sh/foo");`;
      await assertRejects(
        () =>
          rewriteModuleImports(original, "https://esm.sh/parent", defaultOptions, async () => null),
        Error,
        "Failed to cache absolute HTTP module",
      );
    });

    it("aborts when a static specifier's cache lookup throws", async () => {
      const original = `import foo from "https://esm.sh/foo";`;
      await assertRejects(
        () =>
          rewriteModuleImports(original, "https://esm.sh/parent", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });
  });
});
