import "#veryfront/schemas/_test-setup.ts";
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
    const issues = validateExtension({
      name: "",
      version: "1.0.0",
      capabilities: [],
    });
    assertEquals(issues.some((i) => i.includes("name")), true);
  });

  it("rejects missing version", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "",
      capabilities: [],
    });
    assertEquals(issues.some((i) => i.includes("version")), true);
  });

  it("rejects missing capabilities array", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
    });
    assertEquals(issues.some((i) => i.includes("capabilities")), true);
  });

  it("rejects non-object capability entries", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: ["not-an-object"],
    });
    assertEquals(issues.some((i) => i.includes("capabilities[0]")), true);
  });

  it("rejects capability missing type field", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [{ scope: "global" }],
    });
    assertEquals(issues.some((i) => i.includes("type")), true);
  });

  it("rejects array capability entry", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [[]],
    });
    assertEquals(issues.some((i) => i.includes("capabilities[0]")), true);
  });

  it("rejects null input", () => {
    const issues = validateExtension(null);
    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.includes("object"), true);
  });

  it("rejects undefined input", () => {
    const issues = validateExtension(undefined);
    assertEquals(issues.length, 1);
  });

  it("rejects string input", () => {
    const issues = validateExtension("not-an-object");
    assertEquals(issues.length, 1);
  });

  it("rejects array input", () => {
    const issues = validateExtension([]);
    assertEquals(issues.length, 1);
  });

  it("rejects number input", () => {
    const issues = validateExtension(42);
    assertEquals(issues.length, 1);
  });
});

const pkg = (name: string, provides: Record<string, unknown>): ResolvedExtension => ({
  extension: { name, version: "1.0.0", capabilities: [], provides },
  source: "package",
  origin: `node_modules/${name}`,
});

const config = (name: string, provides: Record<string, unknown>): ResolvedExtension => ({
  extension: { name, version: "1.0.0", capabilities: [], provides },
  source: "config",
  origin: "veryfront.config.ts",
});

describe("detectConflicts", () => {
  it("detects two extensions providing the same contract", () => {
    const conflicts = detectConflicts([
      pkg("ext-a", { Bundler: {} }),
      pkg("ext-b", { Bundler: {} }),
    ]);
    assertEquals(conflicts.length, 1);
    assertEquals(conflicts[0]?.contract, "Bundler");
    assertEquals(conflicts[0]?.providers.length, 2);
  });

  it("allows config-sourced to win over package-sourced", () => {
    const conflicts = detectConflicts([
      config("ext-config", { Bundler: {} }),
      pkg("ext-pkg", { Bundler: {} }),
    ]);
    assertEquals(conflicts.length, 0);
  });

  it("reports conflict when two config-sourced providers tie", () => {
    const conflicts = detectConflicts([
      config("ext-config-a", { Bundler: {} }),
      config("ext-config-b", { Bundler: {} }),
    ]);
    assertEquals(conflicts.length, 1);
    assertEquals(conflicts[0]?.contract, "Bundler");
    assertEquals(conflicts[0]?.providers.length, 2);
  });

  it("allows single high-priority winner among three providers", () => {
    const conflicts = detectConflicts([
      config("ext-config", { Bundler: {} }),
      pkg("ext-a", { Bundler: {} }),
      pkg("ext-b", { Bundler: {} }),
    ]);
    assertEquals(conflicts.length, 0);
  });

  it("returns no conflicts when no extensions provide contracts", () => {
    const conflicts = detectConflicts([
      {
        extension: { name: "ext-a", version: "1.0.0", capabilities: [] },
        source: "package",
        origin: "node_modules/ext-a",
      },
    ]);
    assertEquals(conflicts.length, 0);
  });

  it("reports multiple contracts independently", () => {
    const conflicts = detectConflicts([
      pkg("ext-a", { Bundler: {}, CacheStore: {} }),
      pkg("ext-b", { Bundler: {}, CacheStore: {} }),
    ]);
    assertEquals(conflicts.length, 2);
    const contracts = conflicts.map((c) => c.contract).sort();
    assertEquals(contracts, ["Bundler", "CacheStore"]);
  });

  it("returns empty for empty extension list", () => {
    assertEquals(detectConflicts([]), []);
  });

  it("preserves ExtensionSource type on providers", () => {
    const conflicts = detectConflicts([
      pkg("ext-a", { Bundler: {} }),
      pkg("ext-b", { Bundler: {} }),
    ]);
    assertEquals(conflicts[0]?.providers[0]?.source, "package");
  });
});
