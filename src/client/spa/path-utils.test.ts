import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getModuleServerUrl, getPathToModuleUrlScript, pathToModuleUrl } from "./path-utils.ts";

type MutableTestGlobal = {
  MODULE_SERVER_URL?: string;
  __veryfrontReleaseAssetModules?: unknown;
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

function runGeneratedPathToModuleUrl(path: string, baseUrl?: string): string {
  const globalRecord = globalThis as unknown as MutableTestGlobal;
  const previousWindow = globalRecord.window;
  const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;

  globalRecord.window = globalThis;
  globalRecord.MODULE_SERVER_URL = "/_vf_modules";

  try {
    return new Function(
      "path",
      "baseUrl",
      `${getPathToModuleUrlScript()}\nreturn pathToModuleUrl(path, baseUrl);`,
    )(path, baseUrl) as string;
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
  }
}

function withReleaseAssetModules<T>(value: unknown, fn: () => T): T {
  const globalRecord = globalThis as unknown as MutableTestGlobal;
  const previousMap = globalRecord.__veryfrontReleaseAssetModules;
  globalRecord.__veryfrontReleaseAssetModules = value;

  try {
    return fn();
  } finally {
    if (previousMap === undefined) {
      delete globalRecord.__veryfrontReleaseAssetModules;
    } else {
      globalRecord.__veryfrontReleaseAssetModules = previousMap;
    }
  }
}

function withGlobalFlag<T>(
  key: "__veryfrontStudioEmbed" | "__veryfrontHMRRefreshTimestamp",
  value: boolean | string,
  fn: () => T,
): T {
  const globalRecord = globalThis as unknown as MutableTestGlobal;
  const previous = globalRecord[key];
  (globalRecord as Record<string, unknown>)[key] = value;

  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete globalRecord[key];
    } else {
      (globalRecord as Record<string, unknown>)[key] = previous;
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
      ["utils/helper.ts", "/_vf_modules", "/_vf_modules/utils/helper.js"],
      [
        "providers/BreakpointsProvider.tsx",
        "/_vf_modules",
        "/_vf_modules/providers/BreakpointsProvider.js",
      ],
      ["some/module", "/_vf_modules", "/_vf_modules/some/module.js"],
      [
        "some/module?version=1",
        "/_vf_modules",
        "/_vf_modules/some/module.js?version=1",
      ],
      ["some/module#named", "/_vf_modules", "/_vf_modules/some/module.js#named"],
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
      ["pages/home.tsx", "/custom/", "/custom/pages/home.js"],
      [
        "pages/home.tsx",
        "https://cdn.example.com/modules/",
        "https://cdn.example.com/modules/pages/home.js",
      ],
    ];

    for (const [input, baseUrl, expected] of cases) {
      it(`should convert ${input} with base ${baseUrl}`, () => {
        assertEquals(pathToModuleUrl(input, baseUrl), expected);
      });
    }

    it("uses release asset modules when available", () => {
      withReleaseAssetModules(
        { "pages/index.mdx": "/_vf/assets/" + "a".repeat(64) + ".js" },
        () => {
          assertEquals(
            pathToModuleUrl("pages/index.mdx"),
            "/_vf/assets/" + "a".repeat(64) + ".js",
          );
        },
      );
    });

    it("never pins release assets during Studio embed or HMR sessions", () => {
      const assetUrl = "/_vf/assets/" + "d".repeat(64) + ".js";

      withReleaseAssetModules({ "pages/index.tsx": assetUrl }, () => {
        withGlobalFlag("__veryfrontStudioEmbed", true, () => {
          assertEquals(
            pathToModuleUrl("pages/index.tsx"),
            "/_vf_modules/pages/index.js",
            "Studio embed loads freshly compiled modules, not pinned release assets",
          );
          assertEquals(
            runGeneratedPathToModuleUrl("pages/index.tsx"),
            "/_vf_modules/pages/index.js",
            "the generated helper also skips pinned release assets during Studio embed",
          );
        });

        withGlobalFlag("__veryfrontHMRRefreshTimestamp", "42", () => {
          assertEquals(
            pathToModuleUrl("pages/index.tsx"),
            "/_vf_modules/pages/index.js",
            "HMR sessions load freshly compiled modules, not pinned release assets",
          );
          assertEquals(
            runGeneratedPathToModuleUrl("pages/index.tsx"),
            "/_vf_modules/pages/index.js",
            "the generated helper also skips pinned release assets during HMR sessions",
          );
        });
      });
    });

    it("does not fall back to a sibling release asset for an explicit source path", () => {
      const siblingAssetUrl = "/_vf/assets/" + "b".repeat(64) + ".js";

      withReleaseAssetModules({ "app/page.ts": siblingAssetUrl }, () => {
        assertEquals(pathToModuleUrl("app/page.tsx"), "/_vf_modules/app/page.js");
        assertEquals(
          runGeneratedPathToModuleUrl("app/page.tsx"),
          "/_vf_modules/app/page.js",
        );
      });
    });

    it("expands release asset variants only for extensionless module paths", () => {
      const assetUrl = "/_vf/assets/" + "c".repeat(64) + ".js";

      withReleaseAssetModules({ "content/page.md": assetUrl }, () => {
        assertEquals(pathToModuleUrl("content/page"), assetUrl);
        assertEquals(runGeneratedPathToModuleUrl("content/page"), assetUrl);
      });
    });

    it("uses one endpoint for authored JavaScript and extensionless module paths", () => {
      for (const resolve of [pathToModuleUrl, runGeneratedPathToModuleUrl]) {
        assertEquals(resolve("app/page.js"), "/_vf_modules/app/page.js");
        assertEquals(resolve("app/page.mjs"), "/_vf_modules/app/page.mjs");
        assertEquals(resolve("app/page"), "/_vf_modules/app/page.js");
      }
    });

    it("normalizes authored sources while preserving query or hash suffixes", () => {
      const cases = [
        ["content/page.md", "/_vf_modules/content/page.js"],
        ["app/page.tsx?cache=1", "/_vf_modules/app/page.js?cache=1"],
        ["lib/runtime.mjs#named", "/_vf_modules/lib/runtime.mjs#named"],
      ] as const;

      for (const [path, expected] of cases) {
        assertEquals(pathToModuleUrl(path), expected);
        assertEquals(runGeneratedPathToModuleUrl(path), expected);
      }
    });

    it("ignores inherited release asset entries in both implementations", () => {
      const inherited = Object.create({
        "pages/index.tsx": "/_vf/assets/inherited.js",
      }) as Record<string, string>;

      withReleaseAssetModules(inherited, () => {
        assertEquals(pathToModuleUrl("pages/index.tsx"), "/_vf_modules/pages/index.js");
        assertEquals(
          runGeneratedPathToModuleUrl("pages/index.tsx"),
          "/_vf_modules/pages/index.js",
        );
      });
    });

    it("ignores invalid release asset values in both implementations", () => {
      for (
        const value of [
          { url: "/_vf/assets/not-a-string.js" },
          "/_vf/assets/\ninvalid.js",
          "x".repeat(4_097),
        ]
      ) {
        withReleaseAssetModules({ "pages/index.tsx": value }, () => {
          assertEquals(pathToModuleUrl("pages/index.tsx"), "/_vf_modules/pages/index.js");
          assertEquals(
            runGeneratedPathToModuleUrl("pages/index.tsx"),
            "/_vf_modules/pages/index.js",
          );
        });
      }
    });

    it("keeps the TypeScript and generated helpers in parity", () => {
      const cases: Array<[string, string | undefined]> = [
        ["pages/index.tsx", undefined],
        ["/_vf_modules/components/Card.js?version=1", undefined],
        ["/project/features/search/index.ts", "/custom/"],
        ["shared/value.mjs#named", "https://cdn.example.com/modules/"],
      ];

      for (const [path, baseUrl] of cases) {
        assertEquals(
          runGeneratedPathToModuleUrl(path, baseUrl),
          pathToModuleUrl(path, baseUrl),
        );
      }
    });

    it("rejects path traversal in both implementations", () => {
      for (
        const path of [
          "pages/../secrets.ts",
          "pages/%2e%2e/secrets.ts",
          "pages/%2e%2e%2fsecrets.ts",
          "pages/%2e%2e%5csecrets.ts",
          "pages/%252e%252e%252fsecrets.ts",
          "pages\\..\\secrets.ts",
        ]
      ) {
        assertThrows(() => pathToModuleUrl(path), TypeError, "path traversal");
        assertThrows(
          () => runGeneratedPathToModuleUrl(path),
          TypeError,
          "path traversal",
        );
      }
    });

    it("rejects empty, oversized, or control-character module paths", () => {
      for (
        const path of [
          "",
          "pages/\nsecret.tsx",
          "pages\\ambiguous.tsx",
          "a".repeat(2_049),
        ]
      ) {
        assertThrows(() => pathToModuleUrl(path), TypeError);
        assertThrows(() => runGeneratedPathToModuleUrl(path), TypeError);
      }
    });

    it("rejects malformed or oversized module server base URLs", () => {
      for (const baseUrl of ["https://modules.invalid/\nheader", "a".repeat(4_097)]) {
        assertThrows(() => pathToModuleUrl("pages/index.tsx", baseUrl), TypeError);
        assertThrows(
          () => runGeneratedPathToModuleUrl("pages/index.tsx", baseUrl),
          TypeError,
        );
      }
    });

    it("keeps existing arbitrary-folder module URLs unchanged in the generated browser helper", () => {
      assertEquals(
        runGeneratedPathToModuleUrl("/_vf_modules/providers/BreakpointsProvider.js"),
        "/_vf_modules/providers/BreakpointsProvider.js",
      );
    });
  });
});
