import { assertEquals, assertThrows } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  componentsFromLock,
  componentsFromLockForManifest,
  dependencyIndexForAllManifests,
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

  it("plans an aggregate SBOM plus one SBOM per workspace manifest", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:react@19.2.4": "19.2.4",
        "npm:bash-tool@1.3.16": "1.3.16",
      },
      npm: {
        "react@19.2.4": { integrity: "sha512-react", dependencies: [] },
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
      },
      workspace: {
        dependencies: ["npm:react@19.2.4"],
        members: {
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
        "extensions/ext-sandbox-shell-tools",
      ],
    });

    assertEquals(
      outputs.map((output) => output.path),
      [
        "dist/sbom-0.1.519/all.json",
        "dist/sbom-0.1.519/core.json",
        "dist/sbom-0.1.519/cli.json",
        "dist/sbom-0.1.519/ext-sandbox-shell-tools.json",
      ],
    );
    assertEquals(
      outputs.map((output) => output.componentName),
      [
        "veryfront",
        "veryfront:deno.json",
        "veryfront:cli/deno.json",
        "veryfront:extensions/ext-sandbox-shell-tools/deno.json",
      ],
    );
    assertEquals(outputs[0].components.map((component) => component.name), [
      "bash-tool",
      "react",
    ]);
    assertEquals(outputs[1].components.map((component) => component.name), [
      "react",
    ]);
    assertEquals(outputs[2].components, []);
    assertEquals(outputs[3].components.map((component) => component.name), [
      "bash-tool",
    ]);
  });

  it("builds a dependency index grouped by core, cli, and extension manifests", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:react@19.2.4": "19.2.4",
        "npm:bash-tool@1.3.16": "1.3.16",
      },
      npm: {
        "react@19.2.4": { integrity: "sha512-react", dependencies: [] },
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
      },
      workspace: {
        dependencies: ["npm:react@19.2.4"],
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
        "extensions/ext-sandbox-shell-tools",
      ],
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
          componentNames: ["react"],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentNames: [],
        },
        {
          sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
          group: "extension",
          componentNames: ["bash-tool"],
        },
      ],
    );
  });
});
