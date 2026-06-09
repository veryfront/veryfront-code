import { assertEquals, assertStringIncludes, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  componentsForManifestBoundary,
  componentsFromEsmShImports,
  componentsFromLock,
  componentsFromLockForManifest,
  dependencyIndexForAllManifests,
  dependencySummaryMarkdown,
  sbomOutputsForAllManifests,
  SUPPORTED_LOCK_VERSIONS,
} from "./generate-sbom.ts";

describe("componentsFromLock", () => {
  it("emits a CycloneDX library component per npm package, deduplicated", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "npm:zod@4.3.6": "4.3.6" },
      npm: {
        "zod@4.3.6": { integrity: "sha512-aaa", dependencies: [] },
        "fast-deep-equal@3.1.3": { integrity: "sha512-bbb" },
      },
    });

    const components = componentsFromLock(lock);

    assertEquals(components.length, 2);
    const zod = components.find((c) => c.name === "zod")!;
    assertEquals(zod.version, "4.3.6");
    assertEquals(zod.purl, "pkg:npm/zod@4.3.6");
    assertEquals(zod.hashes?.[0], { alg: "SHA-512", content: "aaa" });
  });

  it("strips peer-disambiguator suffix from canonical name@version", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: {
        "@mdx-js/mdx@3.1.1_acorn@8.16.0": { integrity: "sha512-x" },
      },
    });
    const c = componentsFromLock(lock)[0];
    assertEquals(c.name, "@mdx-js/mdx");
    assertEquals(c.version, "3.1.1");
    assertEquals(c.purl, "pkg:npm/%40mdx-js/mdx@3.1.1");
  });

  it("deduplicates entries that resolve to the same canonical name@version", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: {
        "@opentelemetry/core@2.6.0": { integrity: "sha512-a" },
        "@opentelemetry/core@2.6.0_@opentelemetry+api@1.9.0": {
          integrity: "sha512-a",
        },
      },
    });
    assertEquals(componentsFromLock(lock).length, 1);
  });

  it("includes scoped npm packages with encoded purl", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: { "@opentelemetry/api@1.9.0": { integrity: "sha512-x" } },
    });
    const components = componentsFromLock(lock);
    assertEquals(components[0].purl, "pkg:npm/%40opentelemetry/api@1.9.0");
  });

  it("ignores jsr — not in scope for npm SBOM", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "jsr:@std/path@1": "1.0.0" },
      jsr: { "@std/path@1.0.0": {} },
    });
    assertEquals(componentsFromLock(lock).length, 0);
  });

  it("throws on unsupported lock format", () => {
    const lock = JSON.stringify({ version: "999", npm: {} });
    assertThrows(
      () => componentsFromLock(lock),
      Error,
      "Unsupported deno.lock version",
    );
  });

  it("SUPPORTED_LOCK_VERSIONS lists at least the current format", () => {
    assertEquals(SUPPORTED_LOCK_VERSIONS.includes("5"), true);
  });

  it("can emit components for one workspace manifest", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:zod@4.3.6": "4.3.6",
        "npm:bash-tool@1.3.16":
          "1.3.16_ai@6.0.182__zod@3.25.76_just-bash@2.14.5",
      },
      npm: {
        "zod@4.3.6": { integrity: "sha512-core", dependencies: [] },
        "bash-tool@1.3.16_ai@6.0.182__zod@3.25.76_just-bash@2.14.5": {
          integrity: "sha512-shell",
          dependencies: [],
        },
      },
      workspace: {
        dependencies: ["npm:zod@4.3.6"],
        members: {
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    assertEquals(
      componentsFromLockForManifest(lock, "deno.json").map((component) =>
        component.name
      ),
      ["zod"],
    );
    assertEquals(
      componentsFromLockForManifest(
        lock,
        "extensions/ext-sandbox-shell-tools/deno.json",
      ).map((component) => component.name),
      ["bash-tool"],
    );
  });

  it("can emit lock and esm.sh components for one workspace manifest boundary", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:bash-tool@1.3.16": "1.3.16",
      },
      npm: {
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
      },
      workspace: {
        dependencies: [],
        members: {
          "extensions/ext-css-tailwind": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    const components = componentsForManifestBoundary(
      lock,
      "extensions/ext-css-tailwind/deno.json",
      {
        manifestImportsByPath: {
          "extensions/ext-css-tailwind/deno.json": {
            tailwindcss: "https://esm.sh/tailwindcss@4.2.2",
          },
        },
      },
    );

    assertEquals(components.map((component) => component.name), [
      "bash-tool",
      "tailwindcss",
    ]);
  });

  it("emits npm package components from esm.sh import aliases", () => {
    const components = componentsFromEsmShImports({
      "@types/react": "https://esm.sh/@types/react@19.2.14?deps=csstype@3.2.3",
      "react/jsx-runtime":
        "https://esm.sh/react@19.2.4/jsx-runtime?external=react&target=es2022",
      "react": "https://esm.sh/react@19.2.4?target=es2022",
      "std/path": "jsr:@std/path@1.2.3",
    });

    assertEquals(
      components.map((component) => ({
        name: component.name,
        version: component.version,
        purl: component.purl,
      })),
      [
        {
          name: "@types/react",
          version: "19.2.14",
          purl: "pkg:npm/%40types/react@19.2.14",
        },
        {
          name: "csstype",
          version: "3.2.3",
          purl: "pkg:npm/csstype@3.2.3",
        },
        {
          name: "react",
          version: "19.2.4",
          purl: "pkg:npm/react@19.2.4",
        },
      ],
    );
  });

  it("ignores non-exact esm.sh deps query packages", () => {
    const components = componentsFromEsmShImports({
      "main": "https://esm.sh/main@1.0.0?deps=range-only@^1,latest-tag@latest",
    });

    assertEquals(components.map((component) => component.name), ["main"]);
  });

  it("plans an aggregate SBOM plus one SBOM per workspace manifest", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:bash-tool@1.3.16": "1.3.16",
      },
      npm: {
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
      },
      workspace: {
        dependencies: [],
        members: {
          "extensions/ext-css-tailwind": {
            dependencies: [],
          },
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    const outputs = sbomOutputsForAllManifests(lock, {
      outputDir: "dist/sbom-0.1.519",
      workspaceMembers: [
        "cli",
        "react",
        "extensions/ext-css-tailwind",
        "extensions/ext-sandbox-shell-tools",
      ],
      manifestImportsByPath: {
        "react/deno.json": {
          react: "https://esm.sh/react@19.2.4?target=es2022",
          "react-dom":
            "https://esm.sh/react-dom@19.2.4?external=react&target=es2022",
          "react/jsx-runtime":
            "https://esm.sh/react@19.2.4/jsx-runtime?deps=csstype@3.2.3&external=react&target=es2022",
        },
        "extensions/ext-css-tailwind/deno.json": {
          tailwindcss: "https://esm.sh/tailwindcss@4.2.2",
          "tailwindcss/plugin": "https://esm.sh/tailwindcss@4.2.2/plugin",
        },
      },
    });

    assertEquals(
      outputs.map((output) => output.path),
      [
        "dist/sbom-0.1.519/all.json",
        "dist/sbom-0.1.519/core.json",
        "dist/sbom-0.1.519/cli.json",
        "dist/sbom-0.1.519/react.json",
        "dist/sbom-0.1.519/ext-css-tailwind.json",
        "dist/sbom-0.1.519/ext-sandbox-shell-tools.json",
      ],
    );
    assertEquals(
      outputs.map((output) => output.componentName),
      [
        "veryfront",
        "veryfront:deno.json",
        "veryfront:cli/deno.json",
        "veryfront:react/deno.json",
        "veryfront:extensions/ext-css-tailwind/deno.json",
        "veryfront:extensions/ext-sandbox-shell-tools/deno.json",
      ],
    );
    assertEquals(outputs[0].components.map((component) => component.name), [
      "bash-tool",
      "csstype",
      "react",
      "react-dom",
      "tailwindcss",
    ]);
    assertEquals(outputs[1].components, []);
    assertEquals(outputs[2].components, []);
    assertEquals(outputs[3].components.map((component) => component.name), [
      "csstype",
      "react",
      "react-dom",
    ]);
    assertEquals(outputs[4].components.map((component) => component.name), [
      "tailwindcss",
    ]);
    assertEquals(outputs[5].components.map((component) => component.name), [
      "bash-tool",
    ]);
  });

  it("builds a dependency index grouped by core, cli, react, and extension manifests", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:bash-tool@1.3.16": "1.3.16",
      },
      npm: {
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
      },
      workspace: {
        dependencies: [],
        members: {
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    const index = dependencyIndexForAllManifests(lock, {
      workspaceMembers: [
        "cli",
        "react",
        "extensions/ext-sandbox-shell-tools",
      ],
      manifestImportsByPath: {
        "react/deno.json": {
          react: "https://esm.sh/react@19.2.4?target=es2022",
        },
      },
    });

    assertEquals(
      index.manifests.map((manifest) => ({
        sourceLocation: manifest.sourceLocation,
        group: manifest.group,
        componentNames: manifest.components.map((component) => component.name),
      })),
      [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentNames: [],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentNames: [],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentNames: ["react"],
        },
        {
          sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
          group: "extension",
          componentNames: ["bash-tool"],
        },
      ],
    );
  });

  it("renders a markdown dependency summary with sensitive boundaries highlighted", () => {
    const summary = dependencySummaryMarkdown({
      generatedBy: "generate-sbom",
      manifests: [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentCount: 3,
          components: [
            {
              name: "react",
              version: "19.2.4",
              purl: "pkg:npm/react@19.2.4",
            },
          ],
        },
        {
          sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
          group: "extension",
          componentCount: 2,
          components: [
            {
              name: "bash-tool",
              version: "1.3.16",
              purl: "pkg:npm/bash-tool@1.3.16",
            },
          ],
        },
      ],
    });

    assertStringIncludes(
      summary,
      "| Core | `deno.json` | 0 | Third-party free |",
    );
    assertStringIncludes(
      summary,
      "| Extension | `extensions/ext-sandbox-shell-tools/deno.json` | 2 | Sensitive: sandbox execution |",
    );
    assertStringIncludes(
      summary,
      "| Sandbox execution | `extensions/ext-sandbox-shell-tools/deno.json` | 2 | `bash-tool`, `just-bash` |",
    );
  });
});
