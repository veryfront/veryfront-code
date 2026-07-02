import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  createExtensionPackageSpec,
  createVeryfrontPeerTypeImportReplacements,
  type ExtensionManifest,
  firstPartyExtensionManifestPaths,
  manifestDependencies,
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
  it("creates publishable package metadata from an extension manifest", () => {
    const manifest: ExtensionManifest = {
      name: "@veryfront/ext-sandbox-shell-tools",
      exports: "./src/index.ts",
      veryfront: {
        extension: true,
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
});
