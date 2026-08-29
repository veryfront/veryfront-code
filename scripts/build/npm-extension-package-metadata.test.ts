import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  assertPackageEntryPointsExist,
  createDntExtensionEntryPoints,
  extensionPackageEntryPointPaths,
} from "./build-npm-extension-packages.ts";
import {
  bareImportPackageNames,
  createExtensionPackageSpec,
  createExtensionPackageSpecs,
  createVeryfrontPeerTypeImportReplacements,
  type ExtensionManifest,
  firstPartyExtensionManifestPaths,
  manifestDependencies,
  normalizeExtensionEntryPoints,
  normalizeExtensionPackageJson,
  type RootPackageConfig,
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
  it("pins S3 to the first audit-clean fix-forward AWS SDK pair", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile("extensions/ext-blob-s3/deno.json"),
    ) as ExtensionManifest;

    assertEquals(manifestDependencies(manifest), {
      "@aws-sdk/client-s3": "3.980.0",
      "@aws-sdk/lib-storage": "3.980.0",
    });
  });

  it("pins the audit-clean Sharp release", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile("extensions/ext-image-sharp/deno.json"),
    ) as ExtensionManifest & {
      veryfront?: { npm?: { nodeEngine?: string } };
    };

    assertEquals(manifestDependencies(manifest), { sharp: "0.35.3" });
  });

  it("pins SQLite to a release that ships prebuilt binaries", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile("extensions/ext-db-sqlite/deno.json"),
    ) as ExtensionManifest;

    assertEquals(manifestDependencies(manifest)["better-sqlite3"], "13.0.3");
  });

  it("rejects native dependencies pinned below their prebuilt-binary floor", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-db-sqlite",
      exports: "./src/index.ts",
      veryfront: { extension: true },
      imports: {
        "better-sqlite3": "npm:better-sqlite3@9.6.0",
      },
    };

    assertThrows(
      () => manifestDependencies(manifest),
      Error,
      "better-sqlite3@9.6.0 predates 13.0.0",
    );
  });

  it("pins bash-tool's required AI SDK peer in the sandbox extension", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(
        "extensions/ext-sandbox-shell-tools/deno.json",
      ),
    ) as ExtensionManifest;

    assertEquals(manifestDependencies(manifest).ai, "7.0.41");
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
});

describe("createExtensionPackageSpec", () => {
  it("publishes local first-party extension imports as same-release dependencies", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-bundler-swc",
      exports: "./src/index.ts",
      veryfront: { extension: true },
      imports: {
        "@veryfront/ext-bundler-esbuild":
          "../ext-bundler-esbuild/src/index.ts",
      },
    };

    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-bundler-swc/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(spec.packageJson.dependencies, {
      "@veryfront/ext-bundler-esbuild": "0.1.985",
    });
    assertEquals(
      spec.dntMappings[
        "file:///repo/extensions/ext-bundler-esbuild/src/index.ts"
      ],
      { name: "@veryfront/ext-bundler-esbuild", version: "0.1.985" },
    );
  });

  it("publishes first-party extension subpath imports from their package root", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-content-mdx",
      exports: "./src/index.ts",
      veryfront: { extension: true },
      imports: {
        "@veryfront/ext-parser-babel/parser-only":
          "../ext-parser-babel/src/parser-only.ts",
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

    assertEquals(spec.packageJson.dependencies, {
      "@veryfront/ext-parser-babel": "0.1.985",
    });
    assertEquals(
      spec.dntMappings[
        "file:///repo/extensions/ext-parser-babel/src/parser-only.ts"
      ],
      {
        name: "@veryfront/ext-parser-babel",
        version: "0.1.985",
        subPath: "parser-only",
      },
    );
  });

  it("externalizes every public Veryfront contract consumed by Redis", async () => {
    const [manifest, actualRootConfig] = await Promise.all([
      Deno.readTextFile("extensions/ext-redis/deno.json").then((source) =>
        JSON.parse(source) as ExtensionManifest
      ),
      Deno.readTextFile("deno.json").then((source) =>
        JSON.parse(source) as RootPackageConfig
      ),
    ]);

    const spec = createExtensionPackageSpec({
      manifestPath: "extensions/ext-redis/deno.json",
      manifest,
      rootConfig: actualRootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(
      Object.values(spec.dntMappings)
        .map((mapping) => mapping.subPath)
        .toSorted(),
      [
        "errors",
        "errors/general",
        "errors/module",
        "extensions/distributed",
        "extensions/distributed/agent-memory-support",
        "extensions/distributed/cache-support",
        "extensions/distributed/rate-limit-support",
        "extensions/distributed/routing-invalidation-support",
        "extensions/types",
        "observability",
        "observability/otlp-setup",
        "platform/env",
        "utils/logger",
        "workflow/claude-code/types",
      ],
    );
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
    assertEquals(spec.packageJson.engines, { node: ">=22.3.0" });
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

  it("applies an extension-specific minimum Node version to base and runtime packages", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-example",
      exports: {
        ".": "./src/index.ts",
        "./node": "./src/node.ts",
      },
      veryfront: {
        extension: true,
        npm: {
          nodeEngine: ">=24.0.0",
          runtimePackages: [{
            name: "@veryfront/ext-example-node",
            export: "./node",
            dependencies: ["example-sdk"],
          }],
        },
      },
      imports: {
        "example-sdk": "npm:example-sdk@1.2.3",
      },
    };

    const specs = createExtensionPackageSpecs({
      manifestPath: "extensions/ext-example/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(
      specs.map((spec) => spec.packageJson.engines),
      [{ node: ">=24.0.0" }, { node: ">=24.0.0" }],
    );
  });

  it("rejects an extension Node floor below the framework minimum", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-example",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
        npm: { nodeEngine: ">=22.2.0" },
      },
    };

    assertThrows(
      () =>
        createExtensionPackageSpec({
          manifestPath: "extensions/ext-example/deno.json",
          manifest,
          rootConfig,
          rootDir: "/repo",
          version: "0.1.985",
          license: "Apache-2.0",
        }),
      Error,
      "cannot be lower than the Veryfront minimum >=22.3.0",
    );
  });

  it("rejects ambiguous extension Node engine ranges", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-example",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
        npm: { nodeEngine: ">=20" },
      },
    };

    assertThrows(
      () =>
        createExtensionPackageSpec({
          manifestPath: "extensions/ext-example/deno.json",
          manifest,
          rootConfig,
          rootDir: "/repo",
          version: "0.1.985",
          license: "Apache-2.0",
        }),
      Error,
      "veryfront.npm.nodeEngine must use the exact minimum-version form >=MAJOR.MINOR.PATCH",
    );
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
        name: "./node",
        path: "extensions/ext-observability-sentry/src/node.ts",
      },
      {
        name: "./deno",
        path: "extensions/ext-observability-sentry/src/deno.ts",
      },
    ]);
    assertEquals(spec.manifestDependencies, {
      "@sentry/deno": "10.68.0",
      "@sentry/node": "10.68.0",
    });
  });

  it("creates lean runtime-specific Sentry package metadata without framework peers or opposite SDKs", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-observability-sentry",
      exports: {
        ".": "./src/index.ts",
        "./node": "./src/node.ts",
        "./deno": "./src/deno.ts",
      },
      veryfront: {
        extension: true,
        npm: {
          stagedSources: [{
            specifier: "#veryfront/observability/application-error-contract.ts",
            source: "src/observability/application-error-contract.ts",
            target: "src/application-error-contract.ts",
          }],
          runtimePackages: [
            {
              name: "@veryfront/ext-observability-sentry-node",
              export: "./node",
              dependencies: ["@sentry/node"],
              peerVeryfront: false,
            },
            {
              name: "@veryfront/ext-observability-sentry-deno",
              export: "./deno",
              dependencies: ["@sentry/deno"],
              peerVeryfront: false,
            },
          ],
        },
      },
      imports: {
        "@sentry/deno": "npm:@sentry/deno@10.68.0",
        "@sentry/node": "npm:@sentry/node@10.68.0",
      },
    };

    const specs = createExtensionPackageSpecs({
      manifestPath: "extensions/ext-observability-sentry/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    });

    assertEquals(specs.map((spec) => spec.packageName), [
      "@veryfront/ext-observability-sentry",
      "@veryfront/ext-observability-sentry-node",
      "@veryfront/ext-observability-sentry-deno",
    ]);
    for (const spec of specs) {
      assertEquals(spec.stagedSources, [{
        specifier: "#veryfront/observability/application-error-contract.ts",
        source: "src/observability/application-error-contract.ts",
        target: "src/application-error-contract.ts",
      }]);
    }

    const legacy = specs[0]!;
    assertEquals(legacy.entryPoints.map((entryPoint) => entryPoint.name), [
      ".",
      "./node",
      "./deno",
    ]);
    assertEquals(legacy.packageJson.peerDependencies, {
      veryfront: "^0.1.985",
    });
    assertEquals(legacy.packageJson.veryfront, manifest.veryfront);
    assertEquals(legacy.manifestDependencies, {
      "@sentry/deno": "10.68.0",
      "@sentry/node": "10.68.0",
    });

    const node = specs[1]!;
    assertEquals(node.packageDirectoryName, "ext-observability-sentry-node");
    assertEquals(node.entryPoints, [{
      name: ".",
      path: "extensions/ext-observability-sentry/src/node.ts",
    }]);
    assertEquals(node.manifestDependencies, {
      "@sentry/node": "10.68.0",
    });
    assertEquals("peerDependencies" in node.packageJson, false);
    assertEquals("veryfront" in node.packageJson, false);

    const deno = specs[2]!;
    assertEquals(deno.packageDirectoryName, "ext-observability-sentry-deno");
    assertEquals(deno.entryPoints, [{
      name: ".",
      path: "extensions/ext-observability-sentry/src/deno.ts",
    }]);
    assertEquals(deno.manifestDependencies, {
      "@sentry/deno": "10.68.0",
    });
    assertEquals("peerDependencies" in deno.packageJson, false);
    assertEquals("veryfront" in deno.packageJson, false);
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

  it("rejects staged source paths that escape the repository", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-example",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
        npm: {
          stagedSources: [{
            specifier: "#veryfront/example.ts",
            source: "../outside.ts",
            target: "src/example.ts",
          }],
        },
      },
    };

    assertThrows(
      () =>
        createExtensionPackageSpecs({
          manifestPath: "extensions/ext-example/deno.json",
          manifest,
          rootConfig,
          rootDir: "/repo",
          version: "0.1.985",
          license: "Apache-2.0",
        }),
      Error,
      "staged source path must stay within the repository",
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

  it("preserves root and runtime subpath entrypoints from an export map", () => {
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
        { name: "./node", path: "extensions/ext-alpha/src/node.ts" },
        { name: "./deno", path: "extensions/ext-alpha/src/deno.ts" },
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
      'extensions/ext-alpha/deno.json contains unsupported extension export key "node"',
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
      'extensions/ext-alpha/deno.json export "./node" must point to a local file path',
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

describe("generated extension package entry points", () => {
  it("collects every file from nested and conditional package exports", () => {
    assertEquals(
      extensionPackageEntryPointPaths({
        main: "./esm/index.js",
        module: "./esm/index.js",
        types: "./esm/index.d.ts",
        exports: {
          ".": {
            import: {
              types: "./esm/src/index.d.ts",
              default: "./esm/src/index.js",
            },
          },
          "./node": [null, { import: "./esm/node.js" }],
        },
      }),
      [
        "./esm/index.d.ts",
        "./esm/index.js",
        "./esm/node.js",
        "./esm/src/index.d.ts",
        "./esm/src/index.js",
      ],
    );
  });

  it("rejects a package whose declared public entry point was not emitted", async () => {
    const outDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${outDir}/esm/src`, { recursive: true });
      await Deno.writeTextFile(`${outDir}/esm/src/index.js`, "export {};\n");

      await assertPackageEntryPointsExist({
        outDir,
        packageName: "@veryfront/ext-example",
        packageJson: {
          exports: { ".": { import: "./esm/src/index.js" } },
        },
      });

      await assertRejects(
        () =>
          assertPackageEntryPointsExist({
            outDir,
            packageName: "@veryfront/ext-example",
            packageJson: {
              exports: {
                ".": {
                  import: "./esm/src/index.js",
                  types: "./esm/src/index.d.ts",
                },
              },
            },
          }),
        Error,
        "@veryfront/ext-example package entry point ./esm/src/index.d.ts was not emitted",
      );
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

  it("normalizes lean runtime package metadata without a Veryfront peer", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-observability-sentry",
      exports: {
        ".": "./src/index.ts",
        "./node": "./src/node.ts",
        "./deno": "./src/deno.ts",
      },
      veryfront: {
        extension: true,
        npm: {
          runtimePackages: [{
            name: "@veryfront/ext-observability-sentry-node",
            export: "./node",
            dependencies: ["@sentry/node"],
            peerVeryfront: false,
          }],
        },
      },
      imports: {
        "@sentry/deno": "npm:@sentry/deno@10.68.0",
        "@sentry/node": "npm:@sentry/node@10.68.0",
      },
    };
    const spec = createExtensionPackageSpecs({
      manifestPath: "extensions/ext-observability-sentry/deno.json",
      manifest,
      rootConfig,
      rootDir: "/repo",
      version: "0.1.985",
      license: "Apache-2.0",
    })[1]!;

    const normalized = normalizeExtensionPackageJson({
      spec,
      version: "0.1.985",
      packageJson: {
        name: "@veryfront/ext-observability-sentry-node",
        module: "./esm/node.js",
        exports: { ".": { import: "./esm/node.js" } },
        dependencies: {
          "@deno/shim-deno": "~0.18.0",
          "@sentry/deno": "10.68.0",
          "@sentry/node": "10.68.0",
          veryfront: "^0.1.985",
        },
        peerDependencies: {
          veryfront: "^0.1.985",
        },
      },
    });

    assertEquals(normalized.dependencies, {
      "@deno/shim-deno": "~0.18.0",
      "@sentry/node": "10.68.0",
    });
    assertEquals("peerDependencies" in normalized, false);
    assertEquals("veryfront" in normalized, false);
    assertEquals(normalized.types, "./esm/node.d.ts");
  });
});
