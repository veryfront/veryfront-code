import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHttpCacheIdentity,
  ensureAbsoluteDir,
  fingerprintImportMap,
  getCanonicalReactEsmVersion,
  hashHttpCacheIdentity,
  hasIncompatibleFilePaths,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  normalizeHttpUrl,
  prepareHttpCacheRequestOptions,
  resolveBareSpecifier,
  SERVER_ESM_TARGET,
} from "./http-cache-helpers.ts";
describe("transforms/esm/http-cache-helpers", () => {
  describe("cache identity", () => {
    it("uses a full SHA-256 fingerprint for import maps that collide under 32-bit hashing", async () => {
      const aaFingerprint = await fingerprintImportMap({
        imports: { collision: "Aa" },
        scopes: {},
      });
      const bbFingerprint = await fingerprintImportMap({
        imports: { collision: "BB" },
        scopes: {},
      });

      assertMatch(aaFingerprint, /^[a-f0-9]{64}$/);
      assertMatch(bbFingerprint, /^[a-f0-9]{64}$/);
      assertNotEquals(aaFingerprint, bbFingerprint);

      const aaIdentity = await buildHttpCacheIdentity("https://modules.example.com/root.js", {
        importMap: { imports: { collision: "Aa" }, scopes: {} },
      });
      const bbIdentity = await buildHttpCacheIdentity("https://modules.example.com/root.js", {
        importMap: { imports: { collision: "BB" }, scopes: {} },
      });
      assertMatch(aaIdentity, /^veryfront:http-module:v2:/);
      assertMatch(await hashHttpCacheIdentity(aaIdentity), /^[a-f0-9]{64}$/);
      assertNotEquals(
        await hashHttpCacheIdentity(aaIdentity),
        await hashHttpCacheIdentity(bbIdentity),
      );
    });

    it("does not consult inherited toJSON hooks while fingerprinting", async () => {
      const original = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let first: string;
      let second: string;
      try {
        Object.defineProperty(Array.prototype, "toJSON", {
          configurable: true,
          value: () => [],
        });
        first = await fingerprintImportMap({ imports: { package: "version-a" } });
        second = await fingerprintImportMap({ imports: { package: "version-b" } });
      } finally {
        if (original) Object.defineProperty(Array.prototype, "toJSON", original);
        else delete (Array.prototype as unknown as { toJSON?: unknown }).toJSON;
      }

      assertNotEquals(first, second);
    });

    it("preserves the established v2 canonical fingerprint bytes", async () => {
      assertEquals(
        await fingerprintImportMap({
          imports: { package: "https://example.com/package.ts" },
          scopes: {
            "https://example.com/": {
              scoped: "https://example.com/scoped.ts",
            },
          },
        }),
        "c0cef34844a37f56972214c773cc169cec17fa1fdd05f80add96f1821ff4650a",
      );
    });

    it("frames URL and React version components without delimiter collisions", async () => {
      const importMap = { imports: {}, scopes: {} };

      assertNotEquals(
        await buildHttpCacheIdentity(
          "https://modules.example.com/root:react=19.0.0",
          { importMap },
        ),
        await buildHttpCacheIdentity("https://modules.example.com/root", {
          importMap,
          reactVersion: "19.0.0",
        }),
      );
    });

    it("partitions HTTP modules by the configured server external package set", async () => {
      const url = "https://modules.example.com/root.js";
      const importMap = { imports: {}, scopes: {} };
      const baseline = await buildHttpCacheIdentity(url, { importMap });
      const knex = await buildHttpCacheIdentity(url, {
        importMap,
        serverExternalPackages: ["knex"],
      });
      const prismaAndKnex = await buildHttpCacheIdentity(url, {
        importMap,
        serverExternalPackages: ["@prisma/client", "knex"],
      });
      const reordered = await buildHttpCacheIdentity(url, {
        importMap,
        serverExternalPackages: ["knex", "@prisma/client"],
      });

      assertNotEquals(knex, baseline);
      assertNotEquals(prismaAndKnex, knex);
      assertEquals(reordered, prismaAndKnex);
    });

    it("does not consult mutable JSON or array hooks for final identities", async () => {
      const importMap = { imports: {}, scopes: {} };
      const baseline = await buildHttpCacheIdentity(
        "https://modules.example.com/root.js",
        { importMap, reactVersion: "19.0.0" },
      );
      assertEquals(
        baseline,
        'veryfront:http-module:v2:["https://modules.example.com/root.js","19.0.0","318ae612f9deb78c22b7ccf3a2d45fe489d63ca499d03712e9df30c41f9c39e5"]',
      );
      const originalStringify = JSON.stringify;
      const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let hookCalls = 0;
      let poisoned: string;

      try {
        Reflect.set(JSON, "stringify", () => "poisoned");
        Object.defineProperty(Array.prototype, "toJSON", {
          configurable: true,
          value() {
            hookCalls++;
            return [];
          },
          writable: true,
        });
        poisoned = await buildHttpCacheIdentity(
          "https://modules.example.com/root.js",
          { importMap, reactVersion: "19.0.0" },
        );
      } finally {
        Reflect.set(JSON, "stringify", originalStringify);
        if (arrayToJson) Object.defineProperty(Array.prototype, "toJSON", arrayToJson);
        else Reflect.deleteProperty(Array.prototype, "toJSON");
      }

      assertEquals(poisoned, baseline);
      assertEquals(hookCalls, 0);
    });

    it("uses captured request-context and URL primordials for identities", async () => {
      const importMap = { imports: {}, scopes: {} };
      const baseline = await buildHttpCacheIdentity(
        "https://esm.sh/lodash@4?z=1&a=2",
        prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap }),
      );
      const otherBaseline = await buildHttpCacheIdentity(
        "https://esm.sh/preact@10?z=2&b=3",
        prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap }),
      );
      const objectDefineProperty = Object.defineProperty;
      const urlDescriptor = Object.getOwnPropertyDescriptor(globalThis, "URL")!;
      const encodeURIComponentDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "encodeURIComponent",
      )!;
      const urlPrototype = URL.prototype;
      const urlPrototypeDescriptors = Object.getOwnPropertyDescriptors(urlPrototype);
      const searchParamsPrototypeDescriptors = Object.getOwnPropertyDescriptors(
        URLSearchParams.prototype,
      );
      const stringPrototypeDescriptors = Object.getOwnPropertyDescriptors(String.prototype);
      const arrayPrototype: object = Array.prototype;
      const arrayPrototypeDescriptors = Object.getOwnPropertyDescriptors(arrayPrototype);
      const regExpPrototypeDescriptors = Object.getOwnPropertyDescriptors(RegExp.prototype);
      let definePropertyCalls = 0;
      let urlCalls = 0;
      let urlPrototypeCalls = 0;
      let poisoned: string;
      let otherPoisoned: string;

      try {
        objectDefineProperty(Object, "defineProperty", {
          configurable: true,
          value() {
            definePropertyCalls++;
            throw new Error("poisoned defineProperty");
          },
          writable: true,
        });
        objectDefineProperty(globalThis, "URL", {
          configurable: true,
          value: class PoisonedURL {
            constructor() {
              urlCalls++;
              throw new Error("poisoned URL");
            }
          },
          writable: true,
        });
        for (const name of ["hostname", "pathname", "searchParams"]) {
          objectDefineProperty(urlPrototype, name, {
            configurable: true,
            get() {
              urlPrototypeCalls++;
              throw new Error(`poisoned URL.prototype.${name}`);
            },
            set() {
              urlPrototypeCalls++;
              throw new Error(`poisoned URL.prototype.${name}`);
            },
          });
        }
        objectDefineProperty(urlPrototype, "toString", {
          configurable: true,
          value() {
            urlPrototypeCalls++;
            return "https://evil.invalid/collapsed";
          },
          writable: true,
        });
        for (const name of ["get", "has", "set", "sort"]) {
          objectDefineProperty(URLSearchParams.prototype, name, {
            configurable: true,
            value() {
              urlPrototypeCalls++;
              throw new Error(`poisoned URLSearchParams.prototype.${name}`);
            },
            writable: true,
          });
        }
        for (const name of ["includes", "replace", "split"]) {
          objectDefineProperty(String.prototype, name, {
            configurable: true,
            value() {
              urlPrototypeCalls++;
              return "https://evil.invalid/collapsed";
            },
            writable: true,
          });
        }
        for (const name of ["filter", "includes", "join", "push"]) {
          objectDefineProperty(arrayPrototype, name, {
            configurable: true,
            value() {
              urlPrototypeCalls++;
              throw new Error(`poisoned Array.prototype.${name}`);
            },
            writable: true,
          });
        }
        for (const name of ["exec", "test"]) {
          objectDefineProperty(RegExp.prototype, name, {
            configurable: true,
            value() {
              urlPrototypeCalls++;
              throw new Error(`poisoned RegExp.prototype.${name}`);
            },
            writable: true,
          });
        }
        objectDefineProperty(globalThis, "encodeURIComponent", {
          configurable: true,
          value() {
            urlPrototypeCalls++;
            return "collapsed";
          },
          writable: true,
        });

        poisoned = await buildHttpCacheIdentity(
          "https://esm.sh/lodash@4?z=1&a=2",
          prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap }),
        );
        otherPoisoned = await buildHttpCacheIdentity(
          "https://esm.sh/preact@10?z=2&b=3",
          prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap }),
        );
      } finally {
        objectDefineProperty(Object, "defineProperty", {
          configurable: true,
          value: objectDefineProperty,
          writable: true,
        });
        objectDefineProperty(globalThis, "URL", urlDescriptor);
        objectDefineProperty(globalThis, "encodeURIComponent", encodeURIComponentDescriptor);
        Object.defineProperties(urlPrototype, urlPrototypeDescriptors);
        Object.defineProperties(URLSearchParams.prototype, searchParamsPrototypeDescriptors);
        Object.defineProperties(String.prototype, stringPrototypeDescriptors);
        Object.defineProperties(arrayPrototype, arrayPrototypeDescriptors);
        Object.defineProperties(RegExp.prototype, regExpPrototypeDescriptors);
      }

      assertEquals(poisoned, baseline);
      assertEquals(otherPoisoned, otherBaseline);
      assertNotEquals(poisoned, otherPoisoned);
      assertEquals(definePropertyCalls, 0);
      assertEquals(urlCalls, 0);
      assertEquals(urlPrototypeCalls, 0);
    });

    it("preserves query identity with captured query intrinsics", async () => {
      const importMap = { imports: {}, scopes: {} };
      const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
      const originalAppend = Object.getOwnPropertyDescriptor(
        URLSearchParams.prototype,
        "append",
      );
      const baselineUrl = "https://esm.sh/pkg@1?dup=one&dup=two&encoded=a%2Bb&q=a+b";
      const expectedNormalized =
        "https://esm.sh/pkg@1?dup=one&dup=two&encoded=a%2Bb&external=react&q=a+b&target=es2022";
      const baselineIdentity = await buildHttpCacheIdentity(baselineUrl, { importMap });
      let iteratorCalls = 0;
      let appendCalls = 0;
      let poisonedNormalized = "";
      let poisonedIdentity = "";

      try {
        Object.defineProperty(Array.prototype, Symbol.iterator, {
          configurable: true,
          value() {
            iteratorCalls++;
            return (originalIterator?.value as () => Iterator<unknown>).call([]);
          },
          writable: true,
        });
        Object.defineProperty(URLSearchParams.prototype, "append", {
          configurable: true,
          value() {
            appendCalls++;
            throw new Error("poisoned URLSearchParams.prototype.append");
          },
          writable: true,
        });

        poisonedNormalized = normalizeHttpUrl(baselineUrl);
        poisonedIdentity = await buildHttpCacheIdentity(baselineUrl, { importMap });
      } finally {
        if (originalIterator) {
          Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
        } else {
          Reflect.deleteProperty(Array.prototype, Symbol.iterator);
        }
        if (originalAppend) {
          Object.defineProperty(URLSearchParams.prototype, "append", originalAppend);
        } else {
          Reflect.deleteProperty(URLSearchParams.prototype, "append");
        }
      }

      assertEquals(poisonedNormalized, expectedNormalized);
      assertEquals(poisonedIdentity, baselineIdentity);
      assertEquals(iteratorCalls, 0);
      assertEquals(appendCalls, 0);
    });

    it("does not consult inherited toJSON hooks while fingerprinting import maps", async () => {
      const importMap = {
        imports: { pkg: "https://modules.example.com/pkg-v1.js" },
        scopes: {
          "https://app.example.com/": {
            scoped: "https://modules.example.com/scoped-v1.js",
          },
        },
      };
      const baseline = await fingerprintImportMap(importMap);
      const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      let hookCalls = 0;

      try {
        Object.defineProperty(Array.prototype, "toJSON", {
          configurable: true,
          value() {
            hookCalls++;
            return [];
          },
          writable: true,
        });
        Object.defineProperty(Object.prototype, "toJSON", {
          configurable: true,
          value() {
            hookCalls++;
            return {};
          },
          writable: true,
        });

        assertEquals(await fingerprintImportMap(importMap), baseline);
      } finally {
        if (arrayToJson) {
          Object.defineProperty(Array.prototype, "toJSON", arrayToJson);
        } else {
          Reflect.deleteProperty(Array.prototype, "toJSON");
        }
        if (objectToJson) {
          Object.defineProperty(Object.prototype, "toJSON", objectToJson);
        } else {
          Reflect.deleteProperty(Object.prototype, "toJSON");
        }
      }

      assertEquals(hookCalls, 0);
    });

    it("canonicalizes and fingerprints one import map once per prepared request graph", async () => {
      let importEnumerations = 0;
      const imports = new Proxy({ pkg: "https://modules.example.com/pkg.js" }, {
        ownKeys(target) {
          importEnumerations++;
          return Reflect.ownKeys(target);
        },
      });
      const options = prepareHttpCacheRequestOptions({
        cacheDir: ".cache",
        importMap: { imports, scopes: {} },
      });

      await Promise.all([
        buildHttpCacheIdentity("https://modules.example.com/a.js", options),
        buildHttpCacheIdentity("https://modules.example.com/b.js", options),
        buildHttpCacheIdentity("https://modules.example.com/c.js", options),
      ]);

      assertEquals(importEnumerations, 1);
    });

    it("does not reuse a prepared fingerprint across separate top-level requests", async () => {
      const importMap = {
        imports: { pkg: "https://modules.example.com/v1.js" },
        scopes: {},
      };
      const firstOptions = prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap });
      const first = await buildHttpCacheIdentity(
        "https://modules.example.com/root.js",
        firstOptions,
      );

      importMap.imports.pkg = "https://modules.example.com/v2.js";
      const secondOptions = prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap });
      const second = await buildHttpCacheIdentity(
        "https://modules.example.com/root.js",
        secondOptions,
      );

      assertNotEquals(first, second);
    });
  });

  describe("canonical React cache identity", () => {
    it("recognizes root and pinned esm.sh React packages", () => {
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/react@19.0.0/es2022/react.mjs"),
        "19.0.0",
      );
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/v135/react-dom@18.3.1/server.js"),
        "18.3.1",
      );
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/stable/react@18.3.1/index.js"),
        "18.3.1",
      );
    });

    it("does not classify nested or scoped package subpaths as core React", () => {
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/@scope/react@19.0.0/index.js"),
        null,
      );
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/pkg@1.0.0/react@19.0.0/index.js"),
        null,
      );
    });

    it("normalizes missing ambient versions in canonical identities", async () => {
      const url = "https://esm.sh/react@19.0.0?target=es2022";
      const emptyImportMap = { imports: {}, scopes: {} };

      assertEquals(
        await buildHttpCacheIdentity(url, { importMap: emptyImportMap }),
        await buildHttpCacheIdentity(url, {
          importMap: { imports: { unrelated: "https://example.com/a.js" } },
          reactVersion: "19.0.0",
        }),
      );
    });

    it("does not externalize prefixed base React package URLs", () => {
      assertEquals(
        normalizeHttpUrl("https://esm.sh/stable/react@18.3.1"),
        "https://esm.sh/stable/react@18.3.1?target=es2022",
      );
      assertEquals(
        normalizeHttpUrl("https://esm.sh/v135/react@18.3.1"),
        "https://esm.sh/v135/react@18.3.1?target=es2022",
      );
      assertEquals(
        normalizeHttpUrl("https://esm.sh/v135/react-dom@18.3.1/server.js"),
        "https://esm.sh/v135/react-dom@18.3.1/server.js?external=react&target=es2022",
      );
    });
  });

  describe("isHttpUrl", () => {
    it("returns true for https URLs", () => {
      assertEquals(isHttpUrl("https://esm.sh/react@18"), true);
    });

    it("returns true for http URLs", () => {
      assertEquals(isHttpUrl("http://cdn.example.com/lib.js"), true);
    });

    it("returns false for relative paths", () => {
      assertEquals(isHttpUrl("./foo.js"), false);
    });

    it("returns false for bare specifiers", () => {
      assertEquals(isHttpUrl("react"), false);
    });

    it("returns false for file:// URLs", () => {
      assertEquals(isHttpUrl("file:///tmp/foo.js"), false);
    });
  });

  describe("isExternalScheme", () => {
    it("returns true for node: scheme", () => {
      assertEquals(isExternalScheme("node:fs"), true);
    });

    it("returns true for data: scheme", () => {
      assertEquals(isExternalScheme("data:text/plain,hello"), true);
    });

    it("returns true for file: scheme", () => {
      assertEquals(isExternalScheme("file:///tmp/foo.js"), true);
    });

    it("returns true for bun: scheme", () => {
      assertEquals(isExternalScheme("bun:test"), true);
    });

    it("returns true for jsr: scheme", () => {
      assertEquals(isExternalScheme("jsr:@std/dotenv@0.225.6"), true);
    });

    it("returns false for https scheme", () => {
      assertEquals(isExternalScheme("https://example.com"), false);
    });

    it("returns false for bare specifiers", () => {
      assertEquals(isExternalScheme("react"), false);
    });
  });

  describe("isRelative", () => {
    it("returns true for ./ paths", () => {
      assertEquals(isRelative("./foo.js"), true);
    });

    it("returns true for ../ paths", () => {
      assertEquals(isRelative("../foo.js"), true);
    });

    it("returns true for / absolute paths", () => {
      assertEquals(isRelative("/foo.js"), true);
    });

    it("returns false for bare specifiers", () => {
      assertEquals(isRelative("react"), false);
    });

    it("returns false for http URLs", () => {
      assertEquals(isRelative("https://esm.sh/react"), false);
    });
  });

  describe("isParentHttpModule", () => {
    it("returns true when baseUrl is an HTTP URL", () => {
      assertEquals(isParentHttpModule("https://esm.sh/react@18"), true);
    });

    it("returns false when baseUrl is undefined", () => {
      assertEquals(isParentHttpModule(undefined), false);
    });

    it("returns false when baseUrl is a local path", () => {
      assertEquals(isParentHttpModule("/tmp/foo.js"), false);
    });
  });

  describe("isInternalBare", () => {
    it("returns true for veryfront/ imports", () => {
      assertEquals(isInternalBare("veryfront/runtime"), true);
    });

    it("returns true for #veryfront/ imports", () => {
      assertEquals(isInternalBare("#veryfront/utils"), true);
    });

    it("returns true for private import-map aliases", () => {
      assertEquals(isInternalBare("#std/dotenv.ts"), true);
      assertEquals(isInternalBare("#project/env"), true);
    });

    it("returns true for _vf_modules/ imports", () => {
      assertEquals(isInternalBare("_vf_modules/lib.js"), true);
    });

    it("returns true for /_vf_modules/ imports", () => {
      assertEquals(isInternalBare("/_vf_modules/lib.js"), true);
    });

    it("returns true for _veryfront/ imports", () => {
      assertEquals(isInternalBare("_veryfront/lib.js"), true);
    });

    it("returns true for /_veryfront/ imports", () => {
      assertEquals(isInternalBare("/_veryfront/lib.js"), true);
    });

    it("returns true for @std/ imports", () => {
      assertEquals(isInternalBare("@std/path"), true);
    });

    it("returns false for regular bare imports", () => {
      assertEquals(isInternalBare("react"), false);
      assertEquals(isInternalBare("lodash"), false);
    });
  });

  describe("normalizeHttpUrl", () => {
    it("normalizes esm.sh URLs with target param", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4");
      assertEquals(result.includes("target=es2022"), true);
    });

    it("sorts query parameters", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4?z=1&a=2");
      const url = new URL(result);
      const keys = [...url.searchParams.keys()];
      assertEquals(keys, [...keys].sort());
    });

    it("removes /denonext/ from esm.sh paths", () => {
      const result = normalizeHttpUrl("https://esm.sh/denonext/lodash@4");
      assertEquals(result.includes("/denonext/"), false);
    });

    it("preserves inner /denonext/ segments in esm.sh paths", () => {
      const result = normalizeHttpUrl(
        "https://esm.sh/pkg@1/X-abc/denonext/pkg.mjs",
      );
      assertEquals(
        new URL(result).pathname,
        "/pkg@1/X-abc/denonext/pkg.mjs",
      );
    });

    it("returns raw string for malformed URLs", () => {
      assertEquals(normalizeHttpUrl("not-a-url"), "not-a-url");
    });

    it("adds external=react for non-react esm.sh packages", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4");
      assertEquals(result.includes("external="), true);
      assertEquals(result.includes("react"), true);
    });

    it("preserves comma-separated esm.sh external params", () => {
      const result = normalizeHttpUrl(
        "https://esm.sh/recharts@2.15.3?external=react,react-dom&target=es2022",
      );
      assertEquals(result.includes("external=react,react-dom"), true);
      assertEquals(result.includes("%2C"), false);
    });

    it("preserves encoding for non-external comma-separated params", () => {
      const result = normalizeHttpUrl(
        "https://esm.sh/pkg@1.0?deps=a,b&external=react,react-dom&target=es2022",
      );
      assertEquals(result.includes("external=react,react-dom"), true);
      assertEquals(result.includes("deps=a%2Cb"), true);
    });
  });

  describe("ensureAbsoluteDir", () => {
    it("returns absolute paths unchanged", () => {
      assertEquals(ensureAbsoluteDir("/tmp/cache"), "/tmp/cache");
    });

    it("makes relative paths absolute", () => {
      const result = ensureAbsoluteDir("relative/cache");
      assertEquals(result.startsWith("/"), true);
    });
  });

  describe("hasIncompatibleFilePaths", () => {
    it("returns false when no file:// paths exist", () => {
      assertEquals(hasIncompatibleFilePaths("const x = 1;", "/cache"), false);
    });

    it("returns false when bundle paths match local cache dir", () => {
      const code = 'import "file:///cache/veryfront-http-bundle/http-123.mjs";';
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), false);
    });

    it("requires bundle paths to stay inside the local cache directory boundary", () => {
      assertEquals(
        hasIncompatibleFilePaths(
          'import "file:///cache/veryfront-http-bundle/http-123.mjs";',
          "/cache",
        ),
        false,
      );
      assertEquals(
        hasIncompatibleFilePaths(
          'import "file:///cache-other/veryfront-http-bundle/http-123.mjs";',
          "/cache",
        ),
        true,
      );
    });

    it("returns true when bundle paths are from different environment", () => {
      const code = 'import "file:///other/veryfront-http-bundle/http-123.mjs";';
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), true);
    });

    it("uses captured intrinsics after prototype poisoning", () => {
      const code = 'import x from "file:///remote/cache/veryfront-http-bundle/http-deadbeef.mjs";';
      const stringPrototypeDescriptors = Object.getOwnPropertyDescriptors(String.prototype);
      const regExpPrototypeDescriptors = Object.getOwnPropertyDescriptors(RegExp.prototype);

      try {
        Object.defineProperty(RegExp.prototype, "exec", {
          configurable: true,
          value() {
            return null;
          },
          writable: true,
        });
        Object.defineProperty(String.prototype, "includes", {
          configurable: true,
          value() {
            return false;
          },
          writable: true,
        });
        Object.defineProperty(String.prototype, "startsWith", {
          configurable: true,
          value() {
            return true;
          },
          writable: true,
        });

        assertEquals(hasIncompatibleFilePaths(code, "/local/cache"), true);
      } finally {
        Object.defineProperties(String.prototype, stringPrototypeDescriptors);
        Object.defineProperties(RegExp.prototype, regExpPrototypeDescriptors);
      }
    });

    it("ignores non-bundle file:// paths", () => {
      const code = 'import "file:///other/some-file.js";';
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), false);
    });
  });

  describe("resolveBareSpecifier", () => {
    const emptyImportMap = { imports: {}, scopes: {} };

    it("resolves bare specifiers to esm.sh URLs", () => {
      const result = resolveBareSpecifier("lodash", emptyImportMap);
      assertEquals(result.startsWith("https://esm.sh/"), true);
      assertEquals(result.includes(`target=${SERVER_ESM_TARGET}`), true);
    });

    it("preserves pinned package versions", () => {
      const result = resolveBareSpecifier("@tanstack/react-query@5.94.4", emptyImportMap);
      assertEquals(
        result,
        `https://esm.sh/@tanstack/react-query@5.94.4?target=${SERVER_ESM_TARGET}`,
      );
    });

    it("requests a server build, not the browser one", () => {
      // Both pull decode-named-character-reference, whose browser build calls
      // document.createElement at module scope and throws during SSG.
      assertEquals(SERVER_ESM_TARGET, "node");
      for (const specifier of ["react-markdown@9.0.3", "remark-gfm@4.0.1"]) {
        const result = resolveBareSpecifier(specifier, emptyImportMap);
        assertEquals(result.includes("target=es2022"), false, specifier);
        assertEquals(result.includes(`target=${SERVER_ESM_TARGET}`), true, specifier);
      }
    });

    it("resolves react subpaths", () => {
      assertEquals(
        resolveBareSpecifier("react/jsx-runtime", emptyImportMap, "19.1.0"),
        "https://esm.sh/react@19.1.0/jsx-runtime?external=react&target=es2022&deps=csstype@3.2.3",
        "an enumerated react subpath resolves through the canonical React import map",
      );
      assertEquals(
        resolveBareSpecifier("react/compiler-runtime", emptyImportMap, "19.1.0"),
        "https://esm.sh/react@19.1.0/compiler-runtime?external=react&target=es2022",
        "non-enumerated react subpaths keep react external and stay off the node target",
      );
    });

    it("resolves react-dom subpaths", () => {
      assertEquals(
        resolveBareSpecifier("react-dom/client", emptyImportMap, "19.1.0"),
        "https://esm.sh/react-dom@19.1.0/client?external=react&target=es2022&deps=csstype@3.2.3",
        "an enumerated react-dom subpath resolves through the canonical React import map",
      );
      assertEquals(
        resolveBareSpecifier("react-dom/test-utils", emptyImportMap, "19.1.0"),
        "https://esm.sh/react-dom@19.1.0/test-utils?external=react&target=es2022",
        "non-enumerated react-dom subpaths keep react external",
      );
    });

    it("uses captured string intrinsics after prototype poisoning", () => {
      const stringPrototypeDescriptors = Object.getOwnPropertyDescriptors(String.prototype);

      try {
        Object.defineProperty(String.prototype, "startsWith", {
          configurable: true,
          value() {
            return false;
          },
          writable: true,
        });
        Object.defineProperty(String.prototype, "slice", {
          configurable: true,
          value() {
            return "poisoned";
          },
          writable: true,
        });

        assertEquals(isHttpUrl("https://esm.sh/react@19"), true);
        assertEquals(isExternalScheme("file:///tmp/module.js"), true);
        assertEquals(isRelative("./local.js"), true);
        assertEquals(isInternalBare("veryfront/runtime"), true);
        assertEquals(
          resolveBareSpecifier("react-dom/client", emptyImportMap, "19.1.0"),
          "https://esm.sh/react-dom@19.1.0/client?external=react&target=es2022&deps=csstype@3.2.3",
        );
      } finally {
        Object.defineProperties(String.prototype, stringPrototypeDescriptors);
      }
    });
  });
});
