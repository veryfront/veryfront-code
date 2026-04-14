/**
 * Extension validation and conflict detection tests.
 *
 * @module extensions/validation.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { detectConflicts, validateExtension } from "./validation.ts";
import type { Extension, ResolvedExtension } from "./types.ts";

describe("validateExtension", () => {
  it("accepts a valid extension", () => {
    const ext: Extension = {
      name: "test-ext",
      version: "1.0.0",
      capabilities: [{ type: "render" }],
    };
    assertEquals(validateExtension(ext), []);
  });

  it("rejects missing name", () => {
    const ext = {
      name: "",
      version: "1.0.0",
      capabilities: [],
    } as Extension;
    const issues = validateExtension(ext);
    assertEquals(issues.length > 0, true);
    assertEquals(issues.some((i) => i.includes("name")), true);
  });

  it("rejects missing version", () => {
    const ext = {
      name: "test-ext",
      version: "",
      capabilities: [],
    } as Extension;
    const issues = validateExtension(ext);
    assertEquals(issues.length > 0, true);
    assertEquals(issues.some((i) => i.includes("version")), true);
  });

  it("rejects missing capabilities array", () => {
    const ext = {
      name: "test-ext",
      version: "1.0.0",
      capabilities: undefined,
    } as unknown as Extension;
    const issues = validateExtension(ext);
    assertEquals(issues.length > 0, true);
    assertEquals(issues.some((i) => i.includes("capabilities")), true);
  });

  it("rejects non-object capabilities", () => {
    const ext = {
      name: "test-ext",
      version: "1.0.0",
      capabilities: ["not-an-object"] as unknown as Extension["capabilities"],
    };
    const issues = validateExtension(ext);
    assertEquals(issues.length > 0, true);
    assertEquals(issues.some((i) => i.includes("capabilities[0]")), true);
  });

  it("rejects capabilities missing type", () => {
    const ext = {
      name: "test-ext",
      version: "1.0.0",
      capabilities: [{ scope: "global" }] as unknown as Extension["capabilities"],
    };
    const issues = validateExtension(ext);
    assertEquals(issues.length > 0, true);
    assertEquals(issues.some((i) => i.includes("type")), true);
  });
});

describe("detectConflicts", () => {
  it("detects two extensions providing the same contract", () => {
    const extensions: ResolvedExtension[] = [
      {
        extension: {
          name: "ext-a",
          version: "1.0.0",
          capabilities: [],
          provides: { Bundler: {} },
        },
        source: "package",
        origin: "node_modules/ext-a",
      },
      {
        extension: {
          name: "ext-b",
          version: "1.0.0",
          capabilities: [],
          provides: { Bundler: {} },
        },
        source: "package",
        origin: "node_modules/ext-b",
      },
    ];
    const conflicts = detectConflicts(extensions);
    assertEquals(conflicts.length, 1);
    assertEquals(conflicts[0].contract, "Bundler");
    assertEquals(conflicts[0].providers.length, 2);
  });

  it("allows config-sourced to win over package-sourced", () => {
    const extensions: ResolvedExtension[] = [
      {
        extension: {
          name: "ext-config",
          version: "1.0.0",
          capabilities: [],
          provides: { Bundler: {} },
        },
        source: "config",
        origin: "veryfront.config.ts",
      },
      {
        extension: {
          name: "ext-pkg",
          version: "1.0.0",
          capabilities: [],
          provides: { Bundler: {} },
        },
        source: "package",
        origin: "node_modules/ext-pkg",
      },
    ];
    const conflicts = detectConflicts(extensions);
    assertEquals(conflicts.length, 0);
  });
});
