import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension validation and conflict detection tests.
 *
 * @module extensions/validation.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("accepts explicit contract metadata", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [{ type: "net:outbound", hosts: ["api.example.com"] }],
      contracts: {
        provides: ["TokenCacheStore"],
        requires: ["SchemaValidator"],
      },
    });

    assertEquals(issues, []);
  });

  it("rejects malformed contract metadata", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [],
      contracts: {
        provides: ["TokenCacheStore", ""],
        requires: [42],
      },
    });

    assertEquals(
      issues.some((issue) => issue.includes("contracts.provides[1]")),
      true,
    );
    assertEquals(
      issues.some((issue) => issue.includes("contracts.requires[0]")),
      true,
    );
  });

  it("rejects malformed optional lifecycle and provider fields", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [],
      setup: "not-a-function",
      teardown: 42,
      provides: { "": {}, Missing: undefined },
      extends: "not-an-array",
    });

    for (const field of ["setup", "teardown", "provides", "extends"]) {
      assertEquals(issues.some((issue) => issue.includes(field)), true);
    }
  });

  it("validates nested preset extensions without recursing forever", () => {
    const invalidChild = { name: "", version: "", capabilities: "invalid" };
    const root: Extension = {
      name: "root",
      version: "1.0.0",
      capabilities: [],
      extends: [invalidChild as unknown as Extension],
    };
    const issues = validateExtension(root);
    assertEquals(issues.some((issue) => issue.includes("extends[0].name")), true);

    root.extends = [root];
    const cyclicIssues = validateExtension(root);
    assertEquals(cyclicIssues.some((issue) => issue.includes("circular")), true);
  });

  it("rejects unbounded or control-character identifiers", () => {
    const issues = validateExtension({
      name: `unsafe\n${"x".repeat(220)}`,
      version: " 1.0.0",
      capabilities: [{ type: "x".repeat(129) }],
      contracts: { provides: ["Contract\nName"] },
    });

    assertEquals(issues.some((issue) => issue.includes("name")), true);
    assertEquals(issues.some((issue) => issue.includes("version")), true);
    assertEquals(issues.some((issue) => issue.includes("capabilities[0].type")), true);
    assertEquals(issues.some((issue) => issue.includes("contracts.provides[0]")), true);

    for (const hiddenCharacter of ["\u2028", "\u202e", "\u200b"]) {
      assertEquals(
        validateExtension({
          name: `unsafe${hiddenCharacter}name`,
          version: "1.0.0",
          capabilities: [],
        }).some((issue) => issue.includes("name")),
        true,
      );
    }
  });

  it("stops inspecting manifest collections at their declared limits", () => {
    let capabilityReads = 0;
    const capabilities = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") return 1_000_000;
        if (typeof property === "string" && /^\d+$/.test(property)) {
          capabilityReads += 1;
          if (capabilityReads > 128) throw new Error("unbounded capability read");
          return { type: "bounded" };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    let contractReads = 0;
    const contracts = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") return 1_000_000;
        if (typeof property === "string" && /^\d+$/.test(property)) {
          contractReads += 1;
          if (contractReads > 128) throw new Error("unbounded contract read");
          return `Contract${contractReads}`;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const capabilityIssues = validateExtension({
      name: "bounded-capabilities",
      version: "1.0.0",
      capabilities,
    });
    const contractIssues = validateExtension({
      name: "bounded-contracts",
      version: "1.0.0",
      capabilities: [],
      contracts: { provides: contracts },
    });

    assertEquals(capabilityReads, 128);
    assertEquals(contractReads, 128);
    assertEquals(capabilityIssues.some((issue) => issue.includes("at most 128")), true);
    assertEquals(contractIssues.some((issue) => issue.includes("at most 128")), true);
    assertEquals(
      [...capabilityIssues, ...contractIssues].some((issue) =>
        issue.includes("could not be read safely")
      ),
      false,
    );
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

  it("reports only providers tied at the winning source priority", () => {
    const conflicts = detectConflicts([
      config("ext-config-a", { Bundler: {} }),
      pkg("ext-package", { Bundler: {} }),
      config("ext-config-b", { Bundler: {} }),
    ]);

    assertEquals(conflicts, [{
      contract: "Bundler",
      providers: [
        { name: "ext-config-a", source: "config" },
        { name: "ext-config-b", source: "config" },
      ],
    }]);
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

  it("reports conflicts for dynamically provided contracts", () => {
    const conflicts = detectConflicts([
      {
        extension: {
          name: "ext-a",
          version: "1.0.0",
          capabilities: [],
          contracts: { provides: ["CacheStore"] },
        },
        source: "package",
        origin: "node_modules/ext-a",
      },
      {
        extension: {
          name: "ext-b",
          version: "1.0.0",
          capabilities: [],
          contracts: { provides: ["CacheStore"] },
        },
        source: "package",
        origin: "node_modules/ext-b",
      },
    ]);

    assertEquals(conflicts.length, 1);
    assertEquals(conflicts[0]?.contract, "CacheStore");
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

  it("rejects invalid resolved sources instead of consulting object prototypes", () => {
    assertThrows(
      () =>
        detectConflicts([
          {
            extension: { name: "unsafe", version: "1.0.0", capabilities: [] },
            source: "__proto__",
            origin: "unsafe",
          } as unknown as ResolvedExtension,
        ]),
      Error,
      "Resolved extension is invalid",
    );
  });

  it("snapshots stateful conflict inputs before analysis", () => {
    let nameReads = 0;
    const extension = {
      version: "1.0.0",
      capabilities: [],
      provides: { Bundler: {} },
    } as Record<string, unknown>;
    Object.defineProperty(extension, "name", {
      enumerable: true,
      get() {
        nameReads += 1;
        if (nameReads > 1) throw new Error("private-stateful-conflict-name");
        return "stable";
      },
    });

    assertEquals(
      detectConflicts([{
        extension: extension as unknown as Extension,
        source: "package",
        origin: "package",
      }]),
      [],
    );
    assertEquals(nameReads, 1);
  });
});
