/**
 * Extension discovery tests.
 *
 * Verifies multi-source extension discovery: package metadata parsing,
 * merge priority, disable directives, and deduplication.
 *
 * @module extensions/discovery.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Extension, ResolvedExtension } from "./types.ts";
import { mergeExtensions, parsePackageMetadata } from "./discovery.ts";

function stubExtension(overrides: Partial<Extension> = {}): Extension {
  return {
    name: "stub",
    version: "1.0.0",
    capabilities: [],
    ...overrides,
  };
}

describe("parsePackageMetadata()", () => {
  it("should detect extension package", () => {
    const result = parsePackageMetadata({
      name: "@veryfront/ext-tailwind",
      veryfront: { extension: true, capabilities: [{ type: "css" }] },
    });
    assertEquals(result?.isExtension, true);
    assertEquals(result?.capabilities.length, 1);
    assertEquals(result?.capabilities[0]?.type, "css");
  });

  it("should return undefined for non-extension package", () => {
    const result = parsePackageMetadata({ name: "lodash" });
    assertEquals(result, undefined);
  });

  it("should return undefined when extension is false", () => {
    const result = parsePackageMetadata({
      name: "some-pkg",
      veryfront: { extension: false },
    });
    assertEquals(result, undefined);
  });
});

describe("mergeExtensions()", () => {
  it("should give config highest priority", () => {
    const configExt = stubExtension({ name: "shared", version: "2.0.0" });
    const packageExt = stubExtension({ name: "shared", version: "1.0.0" });

    const configResolved: ResolvedExtension[] = [
      { extension: configExt, source: "config", origin: "veryfront.config.ts" },
    ];
    const packageResolved: ResolvedExtension[] = [
      { extension: packageExt, source: "package", origin: "node_modules/@veryfront/ext-shared" },
    ];

    const result = mergeExtensions(configResolved, packageResolved, [], []);
    assertEquals(result.length, 1);
    assertEquals(result[0]?.extension.version, "2.0.0");
    assertEquals(result[0]?.source, "config");
  });

  it("should filter disabled extensions", () => {
    const ext = stubExtension({ name: "disabled-ext" });
    const configResolved: ResolvedExtension[] = [
      { extension: ext, source: "config", origin: "veryfront.config.ts" },
    ];

    const result = mergeExtensions(
      configResolved,
      [],
      [],
      [],
      [{ name: "disabled-ext", enabled: false }],
    );
    assertEquals(result.length, 0);
  });

  it("should deduplicate by name keeping highest priority", () => {
    const configExt = stubExtension({ name: "alpha", version: "3.0.0" });
    const packageExt = stubExtension({ name: "alpha", version: "2.0.0" });
    const projectExt = stubExtension({ name: "alpha", version: "1.0.0" });
    const localExt = stubExtension({ name: "beta", version: "1.0.0" });

    const result = mergeExtensions(
      [{ extension: configExt, source: "config", origin: "config" }],
      [{ extension: packageExt, source: "package", origin: "pkg" }],
      [{ extension: projectExt, source: "project", origin: "project" }],
      [{ extension: localExt, source: "local-file", origin: "local" }],
    );
    assertEquals(result.length, 2);
    assertEquals(result[0]?.extension.name, "alpha");
    assertEquals(result[0]?.extension.version, "3.0.0");
    assertEquals(result[1]?.extension.name, "beta");
  });
});
