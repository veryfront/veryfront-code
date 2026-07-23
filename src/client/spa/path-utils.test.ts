import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERSION } from "#veryfront/utils/version-constant.ts";
import { getModuleServerUrl, getPathToModuleUrlScript, pathToModuleUrl } from "./path-utils.ts";

type MutableTestGlobal = {
  MODULE_SERVER_URL?: string;
  __veryfrontReleaseAssetModules?: Record<string, string> | null;
  __veryfrontSetReleaseAssetModules?: (value: Record<string, string> | null) => void;
  __veryfrontReleaseId?: string | null;
  __veryfrontStudioEmbed?: boolean;
  __veryfrontHMRRefreshTimestamp?: string | null;
  window?: unknown;
};

function withWindow<T>(fn: () => T): T {
  const globalRecord = globalThis as unknown as MutableTestGlobal;
  const previousWindow = globalRecord.window;

  globalRecord.window = globalThis;

  try {
    return fn();
  } finally {
    if (previousWindow === undefined) {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  }
}

function runGeneratedPathToModuleUrl(
  path: string,
  baseUrl?: string,
  releaseAssetModules?: Record<string, string> | null,
): string {
  const globalRecord = globalThis as unknown as MutableTestGlobal;
  const previousWindow = globalRecord.window;
  const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
  const previousReleaseMapDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__veryfrontReleaseAssetModules",
  );
  const previousSetterDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__veryfrontSetReleaseAssetModules",
  );

  globalRecord.window = globalThis;
  globalRecord.MODULE_SERVER_URL = "/_vf_modules";

  try {
    return new Function(
      "path",
      "baseUrl",
      "releaseAssetModules",
      `${getPathToModuleUrlScript()}
       if (releaseAssetModules !== undefined) {
         window.__veryfrontSetReleaseAssetModules(releaseAssetModules);
       }
       return pathToModuleUrl(path, baseUrl);`,
    )(path, baseUrl, releaseAssetModules) as string;
  } finally {
    if (previousWindow === undefined) {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }

    if (previousModuleServerUrl === undefined) {
      delete globalRecord.MODULE_SERVER_URL;
    } else {
      globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
    }

    if (previousReleaseMapDescriptor) {
      Object.defineProperty(
        globalThis,
        "__veryfrontReleaseAssetModules",
        previousReleaseMapDescriptor,
      );
    } else {
      delete globalRecord.__veryfrontReleaseAssetModules;
    }
    if (previousSetterDescriptor) {
      Object.defineProperty(
        globalThis,
        "__veryfrontSetReleaseAssetModules",
        previousSetterDescriptor,
      );
    } else {
      delete globalRecord.__veryfrontSetReleaseAssetModules;
    }
  }
}

describe("client/spa/path-utils", () => {
  describe("getModuleServerUrl", () => {
    it("uses the browser-configured module server url when available", () => {
      const globalRecord = globalThis as unknown as MutableTestGlobal;
      const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
      globalRecord.MODULE_SERVER_URL = "https://cdn.example.com/modules";

      try {
        const moduleServerUrl = withWindow(() => getModuleServerUrl());
        assertEquals(moduleServerUrl, "https://cdn.example.com/modules");
      } finally {
        if (previousModuleServerUrl === undefined) {
          delete globalRecord.MODULE_SERVER_URL;
        } else {
          globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
        }
      }
    });

    it("rejects a non-string browser module server value", () => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
      globalRecord.MODULE_SERVER_URL = 42;
      try {
        assertThrows(() => withWindow(() => getModuleServerUrl()), TypeError);
        assertThrows(
          () =>
            withWindow(() =>
              new Function(
                `const MODULE_SERVER_URL = 42;
                 ${getPathToModuleUrlScript()}
                 return pathToModuleUrl('pages/index.tsx');`,
              )()
            ),
          TypeError,
        );
      } finally {
        if (previousModuleServerUrl === undefined) delete globalRecord.MODULE_SERVER_URL;
        else globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
      }
    });
  });

  describe("pathToModuleUrl", () => {
    const cases: Array<[string, string, string]> = [
      ["pages/index.tsx", "/_vf_modules", "/_vf_modules/pages/index.js"],
      ["components/Button.tsx", "/_vf_modules", "/_vf_modules/components/Button.js"],
      ["app/layout.tsx", "/_vf_modules", "/_vf_modules/app/layout.js"],
      ["lib/utils.ts", "/_vf_modules", "/_vf_modules/lib/utils.js"],
      ["layouts/main.tsx", "/_vf_modules", "/_vf_modules/layouts/main.js"],
      ["components/Card.jsx", "/_vf_modules", "/_vf_modules/components/Card.js"],
      ["pages/about.mdx", "/_vf_modules", "/_vf_modules/pages/about.js"],
      ["pages/readme.md", "/_vf_modules", "/_vf_modules/pages/readme.js"],
      ["utils/helper.ts", "/_vf_modules", "/_vf_modules/utils/helper.js"],
      [
        "providers/BreakpointsProvider.tsx",
        "/_vf_modules",
        "/_vf_modules/providers/BreakpointsProvider.js",
      ],
      ["some/module", "/_vf_modules", "/_vf_modules/some/module.js"],
      ["utils/helper.js", "/_vf_modules", "/_vf_modules/utils/helper.js"],
      [
        "/_vf_modules/providers/BreakpointsProvider.js",
        "/_vf_modules",
        "/_vf_modules/providers/BreakpointsProvider.js",
      ],
      [
        "/_vf_modules/custom-client/BreakpointsProvider.js?studio_embed=true",
        "/_vf_modules",
        "/_vf_modules/custom-client/BreakpointsProvider.js?studio_embed=true",
      ],
      ["/project/pages/index.tsx", "/_vf_modules", "/_vf_modules/pages/index.js"],
      ["pages/home.tsx", "/custom", "/custom/pages/home.js"],
    ];

    for (const [input, baseUrl, expected] of cases) {
      it(`should convert ${input} with base ${baseUrl}`, () => {
        assertEquals(pathToModuleUrl(input, baseUrl), expected);
        assertEquals(runGeneratedPathToModuleUrl(input, baseUrl), expected);
      });
    }

    it("uses release asset modules when available", () => {
      const globalRecord = globalThis as typeof globalThis & {
        __veryfrontReleaseAssetModules?: Record<string, string> | null;
      };
      const previousMap = globalRecord.__veryfrontReleaseAssetModules;
      globalRecord.__veryfrontReleaseAssetModules = {
        "pages/index.mdx": "/_vf/assets/" + "a".repeat(64) + ".js",
      };

      try {
        assertEquals(
          pathToModuleUrl("pages/index.mdx"),
          "/_vf/assets/" + "a".repeat(64) + ".js",
        );
      } finally {
        if (previousMap === undefined) {
          delete globalRecord.__veryfrontReleaseAssetModules;
        } else {
          globalRecord.__veryfrontReleaseAssetModules = previousMap;
        }
      }
    });

    it("can resolve against an explicit immutable release context", () => {
      const explicitReleaseMap = {
        "pages/index.tsx": "/assets/release-context.js",
      };
      assertEquals(
        pathToModuleUrl("pages/index.tsx", undefined, explicitReleaseMap),
        "/assets/release-context.js",
      );
      explicitReleaseMap["pages/index.tsx"] = "/assets/mutated.js";
      assertEquals(
        pathToModuleUrl("pages/index.tsx", undefined, explicitReleaseMap),
        "/assets/release-context.js",
      );
    });

    it("keeps existing arbitrary-folder module URLs unchanged in the generated browser helper", () => {
      assertEquals(
        runGeneratedPathToModuleUrl("/_vf_modules/providers/BreakpointsProvider.js"),
        "/_vf_modules/providers/BreakpointsProvider.js",
      );
    });

    it("normalizes trailing slashes on the module server URL", () => {
      assertEquals(
        pathToModuleUrl("pages/index.tsx", "https://cdn.example.com/modules/"),
        "https://cdn.example.com/modules/pages/index.js",
      );
      assertEquals(
        runGeneratedPathToModuleUrl("pages/index.tsx", "https://cdn.example.com/modules/"),
        "https://cdn.example.com/modules/pages/index.js",
      );
    });

    it("applies release, Studio, and HMR cache context consistently", () => {
      const globalRecord = globalThis as unknown as MutableTestGlobal;
      const contextKeys = [
        "__veryfrontReleaseId",
        "__veryfrontStudioEmbed",
        "__veryfrontHMRRefreshTimestamp",
      ] as const;
      const previousDescriptors = new Map(
        contextKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
      );
      const setContext = (
        releaseId: string | null,
        studioEmbed: boolean,
        hmrRefreshTimestamp: string | null,
      ): void => {
        Object.defineProperties(globalThis, {
          __veryfrontReleaseId: {
            configurable: true,
            value: releaseId,
            writable: true,
          },
          __veryfrontStudioEmbed: {
            configurable: true,
            value: studioEmbed,
            writable: true,
          },
          __veryfrontHMRRefreshTimestamp: {
            configurable: true,
            value: hmrRefreshTimestamp,
            writable: true,
          },
        });
      };

      try {
        setContext("rel-1", false, null);
        const releaseUrl = `/_vf_modules/pages/index.js?vf_release=rel-1&vf_runtime=${VERSION}`;
        assertEquals(pathToModuleUrl("pages/index.tsx", "/_vf_modules"), releaseUrl);
        assertEquals(runGeneratedPathToModuleUrl("pages/index.tsx", "/_vf_modules"), releaseUrl);
        assertEquals(
          pathToModuleUrl("pages/index.tsx", "/_vf_modules", undefined, "rel-explicit"),
          `/_vf_modules/pages/index.js?vf_release=rel-explicit&vf_runtime=${VERSION}`,
        );
        assertEquals(
          pathToModuleUrl("pages/index.tsx", "/_vf_modules", undefined, null),
          "/_vf_modules/pages/index.js",
        );
        assertEquals(
          pathToModuleUrl(
            `pages/index.tsx?vf_release=rel-1&vf_runtime=${VERSION}`,
            "/_vf_modules",
          ),
          releaseUrl,
        );
        const releaseUrlWithHash =
          `/_vf_modules/pages/index.js?vf_release=rel-1&vf_runtime=${VERSION}#?vf_release=stale`;
        assertEquals(
          pathToModuleUrl("pages/index.tsx#?vf_release=stale", "/_vf_modules"),
          releaseUrlWithHash,
        );
        assertEquals(
          runGeneratedPathToModuleUrl(
            "pages/index.tsx#?vf_release=stale",
            "/_vf_modules",
          ),
          releaseUrlWithHash,
        );

        const releaseMap = { "pages/index.tsx": "/assets/release-map.js" };
        assertEquals(
          pathToModuleUrl("pages/index.tsx", "/_vf_modules", releaseMap),
          "/assets/release-map.js",
        );
        assertEquals(
          runGeneratedPathToModuleUrl("pages/index.tsx", "/_vf_modules", releaseMap),
          "/assets/release-map.js",
        );

        setContext("rel-1", true, "123");
        assertEquals(
          pathToModuleUrl("pages/index.tsx", "/_vf_modules"),
          "/_vf_modules/pages/index.js?studio_embed=true",
        );
        assertEquals(
          runGeneratedPathToModuleUrl("pages/index.tsx", "/_vf_modules"),
          "/_vf_modules/pages/index.js?studio_embed=true",
        );

        setContext("rel-1", false, "123");
        assertEquals(
          pathToModuleUrl("pages/index.tsx", "/_vf_modules"),
          "/_vf_modules/pages/index.js?t=123",
        );
        assertEquals(
          runGeneratedPathToModuleUrl("pages/index.tsx", "/_vf_modules"),
          "/_vf_modules/pages/index.js?t=123",
        );
      } finally {
        for (const key of contextKeys) {
          const descriptor = previousDescriptors.get(key);
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else delete globalRecord[key];
        }
      }
    });

    it("rejects path traversal in server and generated resolvers", () => {
      for (
        const path of [
          "pages/../secret.tsx",
          "pages/%2e%2e/secret.tsx",
          "pages/%2525252e%2525252e/secret.tsx",
          "pages\\secret.tsx",
        ]
      ) {
        assertThrows(() => pathToModuleUrl(path, "/_vf_modules"), TypeError);
        assertThrows(() => runGeneratedPathToModuleUrl(path, "/_vf_modules"), TypeError);
      }
    });

    it("rejects encoded delimiters and unsafe Unicode in both resolvers", () => {
      for (
        const path of [
          "pages/%3fsecret.tsx",
          "pages/%23secret.tsx",
          "pages/control\n.tsx",
          "pages/bidi\u202esecret.tsx",
          "pages/unpaired\ud800.tsx",
          `pages/${"😀".repeat(1_024)}.tsx`,
        ]
      ) {
        assertThrows(() => pathToModuleUrl(path, "/_vf_modules"), TypeError);
        assertThrows(() => runGeneratedPathToModuleUrl(path, "/_vf_modules"), TypeError);
      }
    });

    it("rejects traversal in the module server base URL", () => {
      for (
        const baseUrl of [
          "../modules",
          "https://cdn.example.com/modules/../private",
          "https://cdn.example.com/modules/%2e%2e/private",
        ]
      ) {
        assertThrows(() => pathToModuleUrl("pages/index.tsx", baseUrl), TypeError);
        assertThrows(
          () => runGeneratedPathToModuleUrl("pages/index.tsx", baseUrl),
          TypeError,
        );
      }
    });

    it("rejects an explicitly empty or unsafe module server base URL", () => {
      for (const baseUrl of ["", "https://cdn.example.com/modules\nnext", "//cdn.example.com"]) {
        assertThrows(() => pathToModuleUrl("pages/index.tsx", baseUrl), TypeError);
        assertThrows(
          () => runGeneratedPathToModuleUrl("pages/index.tsx", baseUrl),
          TypeError,
        );
      }
    });

    it("ignores inherited release-map entries", () => {
      const globalRecord = globalThis as typeof globalThis & {
        __veryfrontReleaseAssetModules?: Record<string, string> | null;
      };
      const previousMap = globalRecord.__veryfrontReleaseAssetModules;
      globalRecord.__veryfrontReleaseAssetModules = Object.create({
        "pages/inherited.tsx": "/_vf/assets/inherited.js",
      }) as Record<string, string>;

      try {
        assertEquals(
          pathToModuleUrl("pages/inherited.tsx", "/_vf_modules"),
          "/_vf_modules/pages/inherited.js",
        );
      } finally {
        if (previousMap === undefined) delete globalRecord.__veryfrontReleaseAssetModules;
        else globalRecord.__veryfrontReleaseAssetModules = previousMap;
      }
    });

    it("rejects unsafe release asset URLs", () => {
      const globalRecord = globalThis as typeof globalThis & {
        __veryfrontReleaseAssetModules?: Record<string, string> | null;
      };
      const previousMap = globalRecord.__veryfrontReleaseAssetModules;
      try {
        for (
          const assetUrl of [
            "javascript:alert(1)",
            "https://cdn.example.com/../private.js",
            "https://cdn.example.com/%2e%2e/private.js",
            "http:cdn.example.com/private.js",
          ]
        ) {
          const releaseAssetModules = { "pages/index.tsx": assetUrl };
          globalRecord.__veryfrontReleaseAssetModules = releaseAssetModules;
          assertThrows(() => pathToModuleUrl("pages/index.tsx"), TypeError);
          assertThrows(
            () => runGeneratedPathToModuleUrl("pages/index.tsx", undefined, releaseAssetModules),
            TypeError,
          );
        }
      } finally {
        if (previousMap === undefined) delete globalRecord.__veryfrontReleaseAssetModules;
        else globalRecord.__veryfrontReleaseAssetModules = previousMap;
      }
    });

    it("does not invoke release-map accessors", () => {
      const globalRecord = globalThis as unknown as MutableTestGlobal;
      const previousMap = globalRecord.__veryfrontReleaseAssetModules;
      let getterCalls = 0;
      const releaseAssetModules = Object.create(null) as Record<string, string>;
      Object.defineProperty(releaseAssetModules, "pages/index.tsx", {
        enumerable: true,
        get() {
          getterCalls++;
          return "/assets/index.js";
        },
      });
      globalRecord.__veryfrontReleaseAssetModules = releaseAssetModules;

      try {
        assertThrows(() => pathToModuleUrl("pages/index.tsx"), TypeError);
        assertEquals(getterCalls, 0);
        assertThrows(
          () => runGeneratedPathToModuleUrl("pages/index.tsx", undefined, releaseAssetModules),
          TypeError,
        );
        assertEquals(getterCalls, 0);
      } finally {
        if (previousMap === undefined) delete globalRecord.__veryfrontReleaseAssetModules;
        else globalRecord.__veryfrontReleaseAssetModules = previousMap;
      }
    });

    it("does not invoke browser configuration accessors", () => {
      const previousDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "__veryfrontReleaseAssetModules",
      );
      let getterCalls = 0;
      Object.defineProperty(globalThis, "__veryfrontReleaseAssetModules", {
        configurable: true,
        get() {
          getterCalls++;
          return { "pages/index.tsx": "/assets/index.js" };
        },
      });

      try {
        assertThrows(() => pathToModuleUrl("pages/index.tsx"), TypeError);
        assertEquals(getterCalls, 0);
        assertThrows(
          () => runGeneratedPathToModuleUrl("pages/index.tsx", "/_vf_modules"),
          TypeError,
        );
        assertEquals(getterCalls, 0);
      } finally {
        if (previousDescriptor) {
          Object.defineProperty(
            globalThis,
            "__veryfrontReleaseAssetModules",
            previousDescriptor,
          );
        } else {
          delete (globalThis as unknown as MutableTestGlobal).__veryfrontReleaseAssetModules;
        }
      }
    });

    it("does not invoke a module-server configuration accessor in the browser helper", () => {
      const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "MODULE_SERVER_URL");
      let getterCalls = 0;
      Object.defineProperty(globalThis, "MODULE_SERVER_URL", {
        configurable: true,
        get() {
          getterCalls++;
          return "/_vf_modules";
        },
      });

      try {
        assertThrows(
          () =>
            withWindow(() =>
              new Function(
                `${getPathToModuleUrlScript()}
                 return pathToModuleUrl('pages/index.tsx');`,
              )()
            ),
          TypeError,
        );
        assertEquals(getterCalls, 0);
      } finally {
        if (previousDescriptor) {
          Object.defineProperty(globalThis, "MODULE_SERVER_URL", previousDescriptor);
        } else {
          delete (globalThis as unknown as MutableTestGlobal).MODULE_SERVER_URL;
        }
      }
    });

    it("bounds and snapshots release asset maps", () => {
      const oversized = Object.fromEntries(
        Array.from({ length: 10_001 }, (_, index) => [
          `components/component-${index}.tsx`,
          `/assets/component-${index}.js`,
        ]),
      );
      assertThrows(
        () => runGeneratedPathToModuleUrl("pages/index.tsx", undefined, oversized),
        TypeError,
      );

      const releaseAssetModules = {
        "pages/index.tsx": "/assets/index-v1.js",
      };
      const previousReleaseMapDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "__veryfrontReleaseAssetModules",
      );
      const previousSetterDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "__veryfrontSetReleaseAssetModules",
      );
      const generated = new Function(
        "releaseAssetModules",
        `${getPathToModuleUrlScript()}
         window.__veryfrontSetReleaseAssetModules(releaseAssetModules);
         const first = pathToModuleUrl('pages/index.tsx');
         releaseAssetModules['pages/index.tsx'] = '/assets/index-v2.js';
         return [first, pathToModuleUrl('pages/index.tsx')];`,
      );
      try {
        assertEquals(
          withWindow(() => generated(releaseAssetModules)),
          ["/assets/index-v1.js", "/assets/index-v1.js"],
        );
      } finally {
        if (previousReleaseMapDescriptor) {
          Object.defineProperty(
            globalThis,
            "__veryfrontReleaseAssetModules",
            previousReleaseMapDescriptor,
          );
        } else {
          delete (globalThis as unknown as MutableTestGlobal).__veryfrontReleaseAssetModules;
        }
        if (previousSetterDescriptor) {
          Object.defineProperty(
            globalThis,
            "__veryfrontSetReleaseAssetModules",
            previousSetterDescriptor,
          );
        } else {
          delete (globalThis as unknown as MutableTestGlobal).__veryfrontSetReleaseAssetModules;
        }
      }
    });

    it("can be evaluated more than once in the same script scope", () => {
      assertEquals(
        withWindow(() =>
          new Function(
            `${getPathToModuleUrlScript()}\n${getPathToModuleUrlScript()}
             return pathToModuleUrl('pages/index.tsx', '/_vf_modules');`,
          )()
        ),
        "/_vf_modules/pages/index.js",
      );
    });
  });
});
