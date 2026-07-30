import { assertEquals, assertStringIncludes, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  createDntExtensionEntryPoints,
  removeUnusedBundledRootSource,
  synchronizeEmittedExtensionManifestVersion,
} from "./build-npm-extension-packages.ts";
import {
  bareImportPackageNames,
  createExtensionPackageSpec,
  createVeryfrontPeerTypeImportReplacements,
  type ExtensionManifest,
  firstPartyExtensionManifestPaths,
  manifestDependencies,
  normalizeExtensionEntryPoints,
  normalizeExtensionPackageJson,
} from "./npm-extension-package-metadata.ts";

const rootConfig = {
  workspace: [
    "./cli",
    "./extensions/ext-sandbox-shell-tools",
    "./extensions/ext-document-kreuzberg",
  ],
  exports: {
    "./extensions": "./src/extensions/index.ts",
    "./extensions/sandbox": "./src/extensions/sandbox/index.ts",
    "./extensions/compat": "./src/extensions/compat/index.ts",
    "./extensions/content": "./src/extensions/content/index.ts",
    "./transforms/mdx-cache":
      "./src/transforms/mdx/esm-module-loader/cache/index.ts",
  },
};

describe("firstPartyExtensionManifestPaths", () => {
  it("discovers first-party extension manifests from the root workspace", () => {
    assertEquals(firstPartyExtensionManifestPaths(rootConfig), [
      "extensions/ext-document-kreuzberg/deno.json",
      "extensions/ext-sandbox-shell-tools/deno.json",
    ]);
  });
});

describe("manifestDependencies", () => {
  it("pins bash-tool's required AI SDK peer in the sandbox extension", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(
        "extensions/ext-sandbox-shell-tools/deno.json",
      ),
    ) as ExtensionManifest;

    assertEquals(manifestDependencies(manifest).ai, "6.0.235");
  });

  it("derives npm dependencies from extension imports", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-sandbox-shell-tools",
      exports: "./src/index.ts",
      veryfront: { extension: true },
      imports: {
        "bash-tool": "npm:bash-tool@1.3.16",
        "just-bash": "npm:just-bash@2.14.5",
        "@std/assert": "jsr:@std/assert@1.0.19",
        "veryfront/extensions/sandbox": "../../src/extensions/sandbox/index.ts",
      },
    };

    assertEquals(manifestDependencies(manifest), {
      "bash-tool": "1.3.16",
      "just-bash": "2.14.5",
    });
  });

  it("deduplicates npm dependencies that share one package with different subpaths", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-document-kreuzberg",
      exports: "./src/index.ts",
      veryfront: { extension: true },
      imports: {
        "@kreuzberg/wasm": "npm:@kreuzberg/wasm@4.5.2",
        "#kreuzberg-wasm-glue":
          "npm:@kreuzberg/wasm@4.5.2/dist/pkg/kreuzberg_wasm.js",
      },
    };

    assertEquals(manifestDependencies(manifest), {
      "@kreuzberg/wasm": "4.5.2",
    });
  });

  it("publishes CSS runtime dependencies only from their independent extensions", async () => {
    const expectedDependencies = {
      "ext-css-lightning": {
        browserslist: "4.28.7",
        lightningcss: "1.29.2",
      },
      "ext-css-purgecss": { purgecss: "8.0.0" },
      "ext-css-tailwind": {
        "@tailwindcss/forms": "0.5.11",
        "@tailwindcss/typography": "0.5.19",
        daisyui: "5.5.14",
        "tailwind-scrollbar-hide": "2.0.0",
        tailwindcss: "4.2.2",
        "tailwindcss-animate": "1.0.7",
      },
    } as const;

    for (
      const [extensionName, expected] of Object.entries(expectedDependencies)
    ) {
      const manifest = JSON.parse(
        await Deno.readTextFile(
          new URL(
            `../../extensions/${extensionName}/deno.json`,
            import.meta.url,
          ),
        ),
      ) as ExtensionManifest;
      const dependencies = manifestDependencies(manifest);
      assertEquals(dependencies, expected);
    }
  });
});

describe("createExtensionPackageSpec", () => {
  it("publishes the offline React renderer as an explicit runtime entrypoint", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile("extensions/ext-react-ssr/deno.json"),
    ) as ExtensionManifest;
    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-react-ssr/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(spec.entryPoints, [
      {
        name: ".",
        path: "extensions/ext-react-ssr/src/index.ts",
      },
      {
        name: "./worker-renderer",
        path: "extensions/ext-react-ssr/src/worker-renderer.ts",
      },
    ]);
    const extensionDependencies = {
      react: "19.2.4",
      "react-dom": "19.2.4",
    };
    assertEquals(spec.manifestDependencies, extensionDependencies);
    assertEquals(spec.packageJson.dependencies, extensionDependencies);
    assertEquals(spec.packageJson.veryfront, manifest.veryfront);

    const runtimeSource = await Deno.readTextFile(
      "extensions/ext-react-ssr/src/worker-renderer.ts",
    );
    assertEquals(runtimeSource.includes('from "react"'), false);
    assertEquals(runtimeSource.includes('from "react-dom/server"'), false);
    assertStringIncludes(runtimeSource, "worker-renderer-bundle.generated.ts");
  });

  it("creates publishable package metadata from an extension manifest", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-sandbox-shell-tools",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
        activation: "explicit",
        contracts: { provides: ["SandboxShellToolsProvider"] },
        capabilities: [{ type: "sandbox:execute", tools: ["bash"] }],
      },
      imports: {
        "bash-tool": "npm:bash-tool@1.3.16",
        "just-bash": "npm:just-bash@2.14.5",
        "veryfront/extensions": "../../src/extensions/index.ts",
        "veryfront/extensions/sandbox": "../../src/extensions/sandbox/index.ts",
      },
    };

    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-sandbox-shell-tools/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(spec.packageName, "@veryfront/ext-sandbox-shell-tools");
    assertEquals(spec.packageDirectoryName, "ext-sandbox-shell-tools");
    assertEquals(
      spec.entryPoint,
      "extensions/ext-sandbox-shell-tools/src/index.ts",
    );
    assertEquals(spec.entryPoints, [
      {
        name: ".",
        path: "extensions/ext-sandbox-shell-tools/src/index.ts",
      },
    ]);
    assertEquals(spec.manifestDependencies, {
      "bash-tool": "1.3.16",
      "just-bash": "2.14.5",
    });
    assertEquals(spec.packageJson.name, "@veryfront/ext-sandbox-shell-tools");
    assertEquals(spec.packageJson.version, "0.1.985");
    assertEquals(spec.packageJson.license, "Apache-2.0");
    assertEquals(spec.packageJson.dependencies, {
      "bash-tool": "1.3.16",
      "just-bash": "2.14.5",
    });
    assertEquals(spec.packageJson.peerDependencies, {
      veryfront: "^0.1.985",
    });
    assertEquals(spec.packageJson.veryfront, manifest.veryfront);

    const mappingKeys = Object.keys(spec.dntMappings).toSorted();
    assertEquals(mappingKeys.length, 2);
    assertStringIncludes(mappingKeys[0]!, "/repo/src/extensions/");
    assertEquals(
      Object.values(spec.dntMappings).toSorted((a, b) =>
        a.subPath!.localeCompare(b.subPath!)
      ),
      [
        { name: "veryfront", version: "^0.1.985", subPath: "extensions" },
        {
          name: "veryfront",
          version: "^0.1.985",
          subPath: "extensions/sandbox",
        },
      ],
    );
  });

  it("creates deterministic npm entry points for explicit extension subpaths", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-parser-babel",
      exports: {
        "./parser-only": "./src/parser-only.ts",
        ".": "./src/index.ts",
      },
      veryfront: {
        extension: true,
        contracts: { provides: ["CodeParser"] },
      },
    };

    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-parser-babel/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(spec.entryPoints, [
      {
        name: ".",
        path: "extensions/ext-parser-babel/src/index.ts",
      },
      {
        name: "./parser-only",
        path: "extensions/ext-parser-babel/src/parser-only.ts",
      },
    ]);
  });

  it("creates publishable package metadata from a multi-entry extension export map", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-observability-sentry",
      exports: {
        ".": "./src/index.ts",
        "./node": "./src/node.ts",
        "./deno": "./src/deno.ts",
      },
      veryfront: { extension: true },
      imports: {
        "@sentry/deno": "npm:@sentry/deno@10.68.0",
        "@sentry/node": "npm:@sentry/node@10.68.0",
      },
    };

    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-observability-sentry/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(
      spec.entryPoint,
      "extensions/ext-observability-sentry/src/index.ts",
    );
    assertEquals(spec.entryPoints, [
      {
        name: ".",
        path: "extensions/ext-observability-sentry/src/index.ts",
      },
      {
        name: "./deno",
        path: "extensions/ext-observability-sentry/src/deno.ts",
      },
      {
        name: "./node",
        path: "extensions/ext-observability-sentry/src/node.ts",
      },
    ]);
    assertEquals(spec.manifestDependencies, {
      "@sentry/deno": "10.68.0",
      "@sentry/node": "10.68.0",
    });
  });

  it("rejects escaping, wildcard, and ambiguous extension entry points", () => {
    const invalidExports: ExtensionManifest["exports"][] = [
      "../outside.ts",
      "./../outside.ts",
      {
        ".": "./src/index.ts",
        "./../outside": "./src/outside.ts",
      },
      {
        ".": "./src/index.ts",
        "./parser/*": "./src/*.ts",
      },
      {
        ".": "./src/index.ts",
        "./parser-only": "./src\\parser-only.ts",
      },
      {
        ".": "./src/index.ts",
        "./parser-only": "./src/../parser-only.ts",
      },
      {
        ".": "./src/index.ts",
        "./%2e%2e/outside": "./src/outside.ts",
      },
      {
        ".": "./src/index.ts",
        "./parser-only": "./src/%2E%2E/outside.ts",
      },
      {
        ".": "./src/index.ts",
        "./node_modules/parser": "./src/parser.ts",
      },
      {
        ".": "./src/index.ts",
        "./parser-only": "./src/node_modules/parser.ts",
      },
      {
        ".": "./src/index.ts",
        "./parser-only": "./src/node%5fmodules/parser.ts",
      },
    ];

    for (const exports of invalidExports) {
      assertThrows(
        () =>
          createExtensionPackageSpec({
            manifestPath: "extensions/ext-parser-babel/deno.json",
            manifest: {
              name: "@veryfront/ext-parser-babel",
              exports,
              veryfront: { extension: true },
            },
            rootConfig,
            rootDir: "/repo",
            version: "0.1.985",
            license: "Apache-2.0",
          }),
        Error,
        "invalid package export",
      );
    }
  });

  it("externalizes public Veryfront contracts but not non-public helper imports", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-content-mdx",
      exports: "./src/index.ts",
      veryfront: { extension: true },
      imports: {
        "veryfront/extensions/content": "../../src/extensions/content/index.ts",
        "veryfront/transforms/frontmatter":
          "../../src/transforms/mdx/compiler/frontmatter-extractor.ts",
      },
    };

    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-content-mdx/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    const mappings = Object.values(spec.dntMappings);
    assertEquals(mappings, [
      { name: "veryfront", version: "^0.1.985", subPath: "extensions/content" },
    ]);
    assertEquals(
      mappings.some((mapping) => mapping.subPath === "transforms/frontmatter"),
      false,
    );
  });
});

describe("normalizeExtensionEntryPoints", () => {
  it("keeps string exports as the root package entrypoint", () => {
    assertEquals(
      normalizeExtensionEntryPoints({
        manifestPath: "extensions/ext-alpha/deno.json",
        manifestDir: "extensions/ext-alpha",
        exports: "./src/index.ts",
      }),
      [{ name: ".", path: "extensions/ext-alpha/src/index.ts" }],
    );
  });

  it("sorts root and runtime subpath entrypoints deterministically", () => {
    assertEquals(
      normalizeExtensionEntryPoints({
        manifestPath: "extensions/ext-alpha/deno.json",
        manifestDir: "extensions/ext-alpha",
        exports: {
          ".": "./src/index.ts",
          "./node": "./src/node.ts",
          "./deno": "./src/deno.ts",
        },
      }),
      [
        { name: ".", path: "extensions/ext-alpha/src/index.ts" },
        { name: "./deno", path: "extensions/ext-alpha/src/deno.ts" },
        { name: "./node", path: "extensions/ext-alpha/src/node.ts" },
      ],
    );
  });

  it("rejects unsupported export keys with a precise manifest message", () => {
    assertThrows(
      () =>
        normalizeExtensionEntryPoints({
          manifestPath: "extensions/ext-alpha/deno.json",
          manifestDir: "extensions/ext-alpha",
          exports: {
            ".": "./src/index.ts",
            "node": "./src/node.ts",
          },
        }),
      Error,
      "extensions/ext-alpha/deno.json contains invalid package export name: node",
    );
  });

  it("rejects non-local export paths with a precise manifest message", () => {
    assertThrows(
      () =>
        normalizeExtensionEntryPoints({
          manifestPath: "extensions/ext-alpha/deno.json",
          manifestDir: "extensions/ext-alpha",
          exports: {
            ".": "./src/index.ts",
            "./node": "../shared/node.ts",
          },
        }),
      Error,
      "extensions/ext-alpha/deno.json contains invalid package export target for ./node",
    );
  });

  it("requires export maps to include the root entrypoint", () => {
    assertThrows(
      () =>
        normalizeExtensionEntryPoints({
          manifestPath: "extensions/ext-alpha/deno.json",
          manifestDir: "extensions/ext-alpha",
          exports: {
            "./node": "./src/node.ts",
          },
        }),
      Error,
      'extensions/ext-alpha/deno.json exports must include "."',
    );
  });
});

describe("createDntExtensionEntryPoints", () => {
  it("builds every normalized extension entrypoint from the repository root", () => {
    assertEquals(
      createDntExtensionEntryPoints({
        rootDir: "/repo",
        spec: {
          entryPoints: [
            { name: ".", path: "extensions/ext-alpha/src/index.ts" },
            { name: "./node", path: "extensions/ext-alpha/src/node.ts" },
            { name: "./deno", path: "extensions/ext-alpha/src/deno.ts" },
          ],
        },
      }),
      [
        { name: ".", path: "/repo/extensions/ext-alpha/src/index.ts" },
        { name: "./node", path: "/repo/extensions/ext-alpha/src/node.ts" },
        { name: "./deno", path: "/repo/extensions/ext-alpha/src/deno.ts" },
      ],
    );
  });
});

describe("synchronizeEmittedExtensionManifestVersion", () => {
  it("injects the published package version into an emitted manifest module", async () => {
    const outDir = await Deno.makeTempDir({
      prefix: "vf-extension-manifest-version-",
    });
    try {
      await Deno.mkdir(`${outDir}/src`, { recursive: true });
      await Deno.mkdir(`${outDir}/esm`, { recursive: true });
      const manifest: ExtensionManifest = {
        name: "@veryfront/ext-react-ssr",
        version: "0.1.0",
        exports: "./src/index.ts",
        veryfront: { extension: true },
      };
      const generatedSource = `export default ${
        JSON.stringify(manifest, null, 2)
      };\n`;
      await Deno.writeTextFile(`${outDir}/src/deno.js`, generatedSource);
      await Deno.writeTextFile(`${outDir}/esm/deno.js`, generatedSource);

      assertEquals(
        await synchronizeEmittedExtensionManifestVersion({
          outDir,
          manifest,
          version: "0.1.985",
        }),
        true,
      );

      const emittedSource = await Deno.readTextFile(`${outDir}/esm/deno.js`);
      assertStringIncludes(emittedSource, '"version": "0.1.985"');
      assertEquals(emittedSource.includes('"version": "0.1.0"'), false);
      assertEquals(manifest.version, "0.1.0");
    } finally {
      await Deno.remove(outDir, { recursive: true });
    }
  });
});

describe("removeUnusedBundledRootSource", () => {
  it("preserves esm/src when package exports point to extension-owned code", async () => {
    const outDir = await Deno.makeTempDir({
      prefix: "vf-extension-root-source-",
    });
    try {
      await Deno.mkdir(`${outDir}/esm/src`, { recursive: true });
      await Deno.writeTextFile(`${outDir}/esm/src/index.js`, "export {};\n");
      await Deno.writeTextFile(
        `${outDir}/package.json`,
        JSON.stringify({
          module: "./esm/src/index.js",
          types: "./esm/src/index.d.ts",
          exports: {
            ".": {
              import: "./esm/src/index.js",
              types: "./esm/src/index.d.ts",
            },
          },
        }),
      );

      await removeUnusedBundledRootSource(outDir);

      assertEquals((await Deno.stat(`${outDir}/esm/src/index.js`)).isFile, true);
    } finally {
      await Deno.remove(outDir, { recursive: true });
    }
  });
});

describe("bareImportPackageNames", () => {
  it("extracts bare specifiers from static, dynamic, side-effect, and require imports", () => {
    const source = [
      `import { z } from "zod";`,
      `import defaultExport from "bash-tool";`,
      `import "polyfill-package";`,
      `export { helper } from "@scope/helpers";`,
      `export * from "@scope/helpers/subpath";`,
      `const lazy = await import("lazy-loaded/deep/module");`,
      `const legacy = require("legacy-package");`,
    ].join("\n");

    assertEquals(bareImportPackageNames(source), [
      "@scope/helpers",
      "bash-tool",
      "lazy-loaded",
      "legacy-package",
      "polyfill-package",
      "zod",
    ]);
  });

  it("reduces subpath imports to their package name, including scoped packages", () => {
    const source = [
      `import glue from "@kreuzberg/wasm/dist/pkg/kreuzberg_wasm.js";`,
      `import worker from "just-bash/worker";`,
    ].join("\n");

    assertEquals(bareImportPackageNames(source), [
      "@kreuzberg/wasm",
      "just-bash",
    ]);
  });

  it("handles multi-line static imports", () => {
    const source = [
      `import {`,
      `  first,`,
      `  second,`,
      `} from "multi-line-package";`,
    ].join("\n");

    assertEquals(bareImportPackageNames(source), ["multi-line-package"]);
  });

  it("ignores relative, absolute, and scheme-prefixed specifiers", () => {
    const source = [
      `import local from "./local.js";`,
      `import parent from "../parent.js";`,
      `import "../side-effect.js";`,
      `import absolute from "/absolute/path.js";`,
      `import fs from "node:fs";`,
      `import remote from "https://example.com/mod.js";`,
      `const dynamicLocal = await import("./dynamic.js");`,
      `const requiredLocal = require("./required.js");`,
    ].join("\n");

    assertEquals(bareImportPackageNames(source), []);
  });

  it("does not treat quoted strings in ordinary code as imports", () => {
    const source = [
      `const query = 'select * from "users"';`,
      `const sql = \``,
      `select *`,
      `from "accounts"`,
      `\`;`,
      `const label = "import";`,
    ].join("\n");

    assertEquals(bareImportPackageNames(source), []);
  });

  it("deduplicates repeated imports of the same package", () => {
    const source = [
      `import { a } from "shared-package";`,
      `import { b } from "shared-package/subpath";`,
      `const c = await import("shared-package");`,
    ].join("\n");

    assertEquals(bareImportPackageNames(source), ["shared-package"]);
  });
});

describe("createVeryfrontPeerTypeImportReplacements", () => {
  it("maps generated relative d.ts imports back to the root veryfront peer", () => {
    const replacements = createVeryfrontPeerTypeImportReplacements({
      rootConfig,
      outDir: "/repo/npm/extensions/ext-document-kreuzberg",
      fromFile:
        "/repo/npm/extensions/ext-document-kreuzberg/esm/extensions/ext-document-kreuzberg/src/index.d.ts",
    });

    assertEquals(
      replacements["../../../src/extensions/index.js"],
      "veryfront/extensions",
    );
    assertEquals(
      replacements["../../../src/extensions/compat/index.js"],
      "veryfront/extensions/compat",
    );
  });
});

describe("normalizeExtensionPackageJson", () => {
  it("publishes copied third-party notices when an extension supplies them", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-react-ssr",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
        contracts: { provides: ["IsolatedSsrRendererProvider"] },
      },
    };
    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-react-ssr/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    const normalized = normalizeExtensionPackageJson({
      spec,
      version: "0.1.985",
      includeThirdPartyNotices: true,
      packageJson: {
        name: "@veryfront/ext-react-ssr",
        module: "./esm/index.js",
        exports: { ".": { import: "./esm/index.js" } },
      },
    });

    assertEquals(normalized.files, [
      "esm",
      "LICENSE",
      "NOTICE",
      "README.md",
      "THIRD_PARTY_NOTICES.md",
    ]);
  });

  it("moves dnt-added veryfront dependency back to a peer and preserves manifest metadata", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-sandbox-shell-tools",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
        contracts: { provides: ["SandboxShellToolsProvider"] },
      },
      imports: {
        "bash-tool": "npm:bash-tool@1.3.16",
        "just-bash": "npm:just-bash@2.14.5",
      },
    };
    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-sandbox-shell-tools/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    const normalized = normalizeExtensionPackageJson({
      spec,
      version: "0.1.985",
      packageJson: {
        name: "@veryfront/ext-sandbox-shell-tools",
        module: "./esm/index.js",
        exports: { ".": { import: "./esm/index.js" } },
        dependencies: {
          "bash-tool": "1.3.16",
          "@deno/shim-deno": "~0.18.0",
          react: "19.2.4",
          veryfront: "^0.1.985",
        },
        devDependencies: {
          "@types/node": "^20.9.0",
        },
        peerDependencies: {},
        _generatedBy: "dnt@dev",
      },
    });

    assertEquals(normalized.dependencies, {
      "bash-tool": "1.3.16",
      "@deno/shim-deno": "~0.18.0",
      "just-bash": "2.14.5",
    });
    assertEquals(normalized.peerDependencies, {
      veryfront: "^0.1.985",
    });
    assertEquals(normalized.type, "module");
    assertEquals(normalized.types, "./esm/index.d.ts");
    assertEquals(normalized.exports, {
      ".": {
        import: "./esm/index.js",
        types: "./esm/index.d.ts",
      },
    });
    assertEquals(normalized.files, ["esm", "LICENSE", "NOTICE", "README.md"]);
    assertEquals(normalized.veryfront, manifest.veryfront);
    assertEquals("_generatedBy" in normalized, false);
    assertEquals("devDependencies" in normalized, false);
  });

  it("publishes declaration paths for every extension subpath", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-parser-babel",
      exports: {
        ".": "./src/index.ts",
        "./parser-only": "./src/parser-only.ts",
      },
      veryfront: {
        extension: true,
        contracts: { provides: ["CodeParser"] },
      },
    };
    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-parser-babel/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    const normalized = normalizeExtensionPackageJson({
      spec,
      version: "0.1.985",
      packageJson: {
        name: "@veryfront/ext-parser-babel",
        module: "./esm/extensions/ext-parser-babel/src/index.js",
        exports: {
          ".": {
            import: "./esm/extensions/ext-parser-babel/src/index.js",
          },
          "./parser-only": {
            import: "./esm/extensions/ext-parser-babel/src/parser-only.js",
          },
        },
      },
    });

    assertEquals(
      normalized.types,
      "./esm/extensions/ext-parser-babel/src/index.d.ts",
    );
    assertEquals(normalized.exports, {
      ".": {
        import: "./esm/extensions/ext-parser-babel/src/index.js",
        types: "./esm/extensions/ext-parser-babel/src/index.d.ts",
      },
      "./parser-only": {
        import: "./esm/extensions/ext-parser-babel/src/parser-only.js",
        types: "./esm/extensions/ext-parser-babel/src/parser-only.d.ts",
      },
    });
  });

  it("adds type declarations for every generated package export", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-observability-sentry",
      exports: {
        ".": "./src/index.ts",
        "./node": "./src/node.ts",
        "./deno": "./src/deno.ts",
      },
      veryfront: { extension: true },
    };
    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-observability-sentry/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    const normalized = normalizeExtensionPackageJson({
      spec,
      version: "0.1.985",
      packageJson: {
        name: "@veryfront/ext-observability-sentry",
        exports: {
          ".": { import: "./esm/index.js" },
          "./node": { import: "./esm/node.js" },
          "./deno": { import: "./esm/deno.js" },
        },
        dependencies: {
          veryfront: "^0.1.985",
        },
      },
    });

    assertEquals(normalized.types, "./esm/index.d.ts");
    assertEquals(normalized.exports, {
      ".": {
        import: "./esm/index.js",
        types: "./esm/index.d.ts",
      },
      "./node": {
        import: "./esm/node.js",
        types: "./esm/node.d.ts",
      },
      "./deno": {
        import: "./esm/deno.js",
        types: "./esm/deno.d.ts",
      },
    });
  });
});
