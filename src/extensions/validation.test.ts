import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension validation and conflict detection tests.
 *
 * @module extensions/validation.test
 */

import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  detectConflicts,
  selectContractProviders,
  SOURCE_PRIORITY,
  validateExtension,
} from "./validation.ts";
import type { Capability, Extension, ResolvedExtension } from "./types.ts";

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

  it("rejects whitespace-only identifiers", () => {
    const issues = validateExtension({
      name: "   ",
      version: "\t",
      capabilities: [{ type: "\n" }],
      contracts: { provides: ["  "], requires: ["\t"] },
      provides: { " ": {} },
    });

    for (const field of ["name", "version", "capabilities[0].type", "contracts.provides"]) {
      assertEquals(issues.some((issue) => issue.includes(field)), true);
    }
    assertEquals(issues.some((issue) => issue.includes("provides key")), true);
  });

  it("rejects identifiers with surrounding whitespace", () => {
    const issues = validateExtension({
      name: " extension ",
      version: " 1.0.0",
      capabilities: [{ type: " fs:read " }],
      contracts: {
        provides: [" CacheStore "],
        requires: [" SchemaValidator "],
      },
      provides: { " StaticContract ": {} },
    });

    for (
      const field of [
        "name",
        "version",
        "capabilities[0].type",
        "contracts.provides[0]",
        "contracts.requires[0]",
        "provides key",
      ]
    ) {
      assertEquals(
        issues.some((issue) => issue.includes(field) && issue.includes("whitespace")),
        true,
      );
    }
  });

  it("rejects ill-formed or line-forging extension identifiers", () => {
    for (const name of ["unsafe\uD800", "unsafe\u0085name", "unsafe\u2028name"]) {
      const issues = validateExtension({
        name,
        version: "1.0.0",
        capabilities: [],
      });
      assertEquals(issues.length, 1);
    }
  });

  it("reports accessor failures as validation issues instead of throwing", () => {
    let getterCalls = 0;
    const extension = {
      version: "1.0.0",
      capabilities: [],
    };
    Object.defineProperty(extension, "name", {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error("name unavailable");
      },
    });

    const issues = validateExtension(extension);
    assertEquals(
      issues.some((issue) => issue.includes("name must be an enumerable own data property")),
      true,
    );
    assertEquals(getterCalls, 0);
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

  it("bounds the runtime capability inventory before inspecting entries", () => {
    const capabilities = Array.from(
      { length: 257 },
      () => ({ type: "custom:metadata" }),
    );
    Object.defineProperty(capabilities[256], "type", {
      enumerable: true,
      get() {
        throw new Error("must not be inspected");
      },
    });

    assertEquals(
      validateExtension({
        name: "test-ext",
        version: "1.0.0",
        capabilities,
      }),
      ["capabilities must contain at most 256 entries"],
    );
  });

  it("descriptor-snapshots proxied capability arrays without invoking getters", () => {
    const capabilities = new Proxy(
      [{ type: "custom:metadata", detail: "safe" }],
      {
        get(target, property, receiver) {
          if (property === "length" || property === "0") {
            throw new Error(`must not read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    assertEquals(
      validateExtension({
        name: "test-ext",
        version: "1.0.0",
        capabilities,
      }),
      [],
    );
  });

  it("normalizes uninspectable capability containers into validation issues", () => {
    const revocable = Proxy.revocable([], {});
    revocable.revoke();

    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: revocable.proxy,
    });
    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.includes("capabilities could not be inspected"), true);
  });

  it("rejects non-JSON custom capability metadata without invoking it", () => {
    const capability = { type: "custom:metadata" } as Capability;
    Object.defineProperty(capability, "secret", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });

    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [capability],
    });
    assertEquals(
      issues.some((issue) => issue.includes("secret must be an enumerable own data property")),
      true,
    );
  });

  it("rejects known capability scopes that could broaden permissions", () => {
    for (
      const [capability, expected] of [
        [{ type: "fs:read", paths: [] }, "paths must be a non-empty array"],
        [{ type: "env:read", keys: ["SAFE,SECRET"] }, "commas or control"],
        [{ type: "net:listen", host: "localhost" }, "host requires"],
        [{ type: "process:spawn", command: ["safe"] }, "unexpected field command"],
        [{ type: "system:read" }, "apis must be a non-empty array"],
        [{ type: "system:read", api: ["cpus"] }, "unexpected field api"],
        [
          { type: "system:read", apis: ["cpus=all"] },
          "supported read-only Deno 2.7.7 system API name",
        ],
      ] as const
    ) {
      const issues = validateExtension({
        name: "test-ext",
        version: "1.0.0",
        capabilities: [capability],
      });
      assertEquals(
        issues.some((issue) => issue.includes(expected)),
        true,
        `expected ${JSON.stringify(issues)} to include ${JSON.stringify(expected)}`,
      );
    }
  });

  it("rejects capability metadata that cannot be serialized or audited", () => {
    const argvIssues = validateExtension({
      name: "argv-overflow",
      version: "1.0.0",
      capabilities: [{
        type: "env:read",
        keys: ["A", "B", "C"].map((prefix) => `${prefix}_${"x".repeat(3_000)}`),
      }],
    });
    assertEquals(
      argvIssues.some((issue) => issue.includes("Deno permission flags exceed")),
      true,
    );

    const auditIssues = validateExtension({
      name: "audit-overflow",
      version: "1.0.0",
      capabilities: [{
        type: "custom",
        first: "\\".repeat(7_000),
        second: "\\".repeat(7_000),
        third: "\\".repeat(7_000),
        fourth: "\\".repeat(7_000),
      }],
    });
    assertEquals(
      auditIssues.some((issue) => issue.includes("formatted capability audit exceeds")),
      true,
    );
  });

  it("rejects inherited known-capability scope fields", () => {
    const capability = Object.assign(
      Object.create({ hosts: ["example.com"] }),
      { type: "net:outbound" },
    );
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [capability],
    });

    assertEquals(
      issues.some((issue) => issue.includes("must be a plain object")),
      true,
    );
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

  it("descriptor-snapshots bounded dense contract arrays", () => {
    const requires = new Proxy(["SchemaValidator"], {
      get(target, property, receiver) {
        if (property === "length" || property === "0") {
          throw new Error(`must not read ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    assertEquals(
      validateExtension({
        name: "test-ext",
        version: "1.0.0",
        capabilities: [],
        contracts: { requires },
      }),
      [],
    );

    const oversized = Array.from({ length: 257 }, (_, index) => `Contract${index}`);
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [],
      contracts: { provides: oversized },
    });
    assertEquals(
      issues.some((issue) => issue.includes("must contain at most 256 entries")),
      true,
    );
  });

  it("rejects hostile modern and legacy contract identifiers", () => {
    for (
      const extension of [
        { contracts: { provides: ["A\nB"] } },
        { contracts: { requires: ["A\u2028B"] } },
        { contracts: { provides: ["A\uD800B"] } },
        { provides: { ["A\u0085B"]: {} } },
      ]
    ) {
      const issues = validateExtension({
        name: "test-ext",
        version: "1.0.0",
        capabilities: [],
        ...extension,
      });
      assertEquals(issues.length > 0, true);
    }
  });

  it("rejects contract accessors without invoking them", () => {
    let getterCalls = 0;
    const provides = {};
    Object.defineProperty(provides, "Danger", {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error("must not run");
      },
    });
    const contracts = {};
    Object.defineProperty(contracts, "requires", {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error("must not run");
      },
    });

    const legacyIssues = validateExtension({
      name: "legacy",
      version: "1.0.0",
      capabilities: [],
      provides,
    });
    const modernIssues = validateExtension({
      name: "modern",
      version: "1.0.0",
      capabilities: [],
      contracts,
    });
    assertEquals(legacyIssues.length > 0, true);
    assertEquals(modernIssues.length > 0, true);
    assertEquals(getterCalls, 0);
  });

  it("rejects inherited extension metadata", () => {
    const extension = Object.assign(
      Object.create({ contracts: { provides: ["Danger"] } }),
      {
        name: "inherited",
        version: "1.0.0",
        capabilities: [],
      },
    );
    assertEquals(validateExtension(extension), ["extension must be a plain object"]);
  });

  it("bounds extension names and versions", () => {
    const issues = validateExtension({
      name: "n".repeat(257),
      version: "v".repeat(129),
      capabilities: [],
    });
    assertEquals(issues.some((issue) => issue.includes("name must not exceed 256")), true);
    assertEquals(issues.some((issue) => issue.includes("version must not exceed 128")), true);
  });

  it("rejects mixed modern and legacy provider declarations", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [],
      contracts: { provides: ["Declared"] },
      provides: { Hidden: {} },
    });

    assertEquals(
      issues.includes("contracts and legacy provides must not be declared together"),
      true,
    );
  });

  it("rejects malformed lifecycle and composition fields", () => {
    const issues = validateExtension({
      name: "test-ext",
      version: "1.0.0",
      capabilities: [],
      setup: "not-a-function",
      teardown: 42,
      provides: [],
      extends: {},
    });

    assertEquals(issues.some((issue) => issue.includes("setup")), true);
    assertEquals(issues.some((issue) => issue.includes("teardown")), true);
    assertEquals(issues.some((issue) => issue.includes("provides")), true);
    assertEquals(issues.some((issue) => issue.includes("extends")), true);
  });

  it("requires preset children to be a bounded dense descriptor snapshot", () => {
    const child: Extension = {
      name: "child",
      version: "1.0.0",
      capabilities: [],
    };
    const children = new Proxy([child], {
      get(target, property, receiver) {
        if (property === "length" || property === "0") {
          throw new Error(`must not read ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    assertEquals(
      validateExtension({
        name: "preset",
        version: "1.0.0",
        capabilities: [],
        extends: children,
      }),
      [],
    );

    const sparse = new Array<Extension>(1);
    const sparseIssues = validateExtension({
      name: "sparse-preset",
      version: "1.0.0",
      capabilities: [],
      extends: sparse,
    });
    assertEquals(
      sparseIssues.some((issue) => issue.includes("dense array")),
      true,
    );

    const oversized = Array.from({ length: 257 }, () => child);
    const oversizedIssues = validateExtension({
      name: "oversized-preset",
      version: "1.0.0",
      capabilities: [],
      extends: oversized,
    });
    assertEquals(
      oversizedIssues.some((issue) => issue.includes("at most 256 entries")),
      true,
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

describe("SOURCE_PRIORITY", () => {
  it("is immutable process-wide policy", () => {
    assertEquals(Object.isFrozen(SOURCE_PRIORITY), true);
    assertEquals(
      SOURCE_PRIORITY,
      { config: 0, package: 1, project: 2, "local-file": 3, builtin: 4 },
      "source priority order is process-wide policy: lower number wins",
    );
  });
});

describe("selectContractProviders", () => {
  it("ranks a project extension above a local-file extension", () => {
    const projectExt: ResolvedExtension = {
      extension: {
        name: "ext-project",
        version: "1.0.0",
        capabilities: [],
        provides: { Bundler: {} },
      },
      source: "project",
      origin: "extensions/ext-project/src/index.ts",
    };
    const localExt: ResolvedExtension = {
      extension: {
        name: "ext-local",
        version: "1.0.0",
        capabilities: [],
        provides: { Bundler: {} },
      },
      source: "local-file",
      origin: "bundler.extension.ts",
    };

    for (const candidates of [[localExt, projectExt], [projectExt, localExt]]) {
      assertStrictEquals(
        selectContractProviders(candidates).get("Bundler"),
        projectExt,
        "a project extension outranks a local-file extension regardless of iteration order",
      );
    }
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
});
