import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getModuleServerUrl, getPathToModuleUrlScript, pathToModuleUrl } from "./path-utils.ts";

type MutableTestGlobal = {
  MODULE_SERVER_URL?: string;
  __veryfrontReleaseAssetModules?: Record<string, string> | null;
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

    it("keeps existing arbitrary-folder module URLs unchanged in the generated browser helper", () => {
      assertEquals(
        runGeneratedPathToModuleUrl("/_vf_modules/providers/BreakpointsProvider.js"),
        "/_vf_modules/providers/BreakpointsProvider.js",
      );
    });
  });
});
