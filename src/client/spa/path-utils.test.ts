import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getModuleServerUrl, pathToModuleUrl } from "./path-utils.ts";

function withWindow<T>(fn: () => T): T {
  const globalRecord = globalThis as typeof globalThis & {
    MODULE_SERVER_URL?: string;
    __veryfrontReleaseAssetModules?: Record<string, string> | null;
    window?: typeof globalThis;
  };
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

describe("client/spa/path-utils", () => {
  describe("getModuleServerUrl", () => {
    it("uses the browser-configured module server url when available", () => {
      const previousModuleServerUrl = globalThis.MODULE_SERVER_URL;
      globalThis.MODULE_SERVER_URL = "https://cdn.example.com/modules";

      try {
        const moduleServerUrl = withWindow(() => getModuleServerUrl());
        assertEquals(moduleServerUrl, "https://cdn.example.com/modules");
      } finally {
        if (previousModuleServerUrl === undefined) {
          delete globalThis.MODULE_SERVER_URL;
        } else {
          globalThis.MODULE_SERVER_URL = previousModuleServerUrl;
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
      ["some/module", "/_vf_modules", "/_vf_modules/some/module.js"],
      ["utils/helper.js", "/_vf_modules", "/_vf_modules/utils/helper.js"],
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
  });
});
