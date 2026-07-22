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
      withReleaseAssetModules({ "pages/index.tsx": { url: "/_vf/assets/not-a-string.js" } }, () => {
        assertEquals(pathToModuleUrl("pages/index.tsx"), "/_vf_modules/pages/index.js");
        assertEquals(
          runGeneratedPathToModuleUrl("pages/index.tsx"),
          "/_vf_modules/pages/index.js",
        );
      });
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

    it("keeps existing arbitrary-folder module URLs unchanged in the generated browser helper", () => {
      assertEquals(
        runGeneratedPathToModuleUrl("/_vf_modules/providers/BreakpointsProvider.js"),
        "/_vf_modules/providers/BreakpointsProvider.js",
      );
    });
  });
});
