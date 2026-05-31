import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  auditExtensionContracts,
  type ExtensionContractAuditInput,
  importWithRetry,
} from "./audit-extension-contracts.ts";

function input(
  overrides: Partial<ExtensionContractAuditInput> = {},
): ExtensionContractAuditInput {
  return {
    manifestPath: "extensions/ext-cache/deno.json",
    manifestCapabilities: [],
    manifestContracts: { provides: ["CacheStore"], requires: [] },
    factoryProvides: ["CacheStore"],
    factoryRequires: [],
    ...overrides,
  };
}

describe("auditExtensionContracts", () => {
  it("accepts matching manifest and factory contract metadata", () => {
    assertEquals(auditExtensionContracts([input()]), []);
  });

  it("flags contract-shaped capabilities in extension manifests", () => {
    const issues = auditExtensionContracts([
      input({
        manifestCapabilities: [{ type: "contract", name: "CacheStore" }],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-cache/deno.json must not use capability type "contract"; use veryfront.contracts instead',
    ]);
  });

  it("flags missing manifest contracts when the factory declares contracts", () => {
    const issues = auditExtensionContracts([
      input({
        manifestContracts: undefined,
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-cache/deno.json is missing veryfront.contracts for factory-declared contracts: provides CacheStore",
    ]);
  });

  it("flags drift between manifest provides and factory provides", () => {
    const issues = auditExtensionContracts([
      input({
        manifestContracts: { provides: ["OtherStore"], requires: [] },
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-cache/deno.json veryfront.contracts.provides differs from factory contracts: manifest OtherStore; factory CacheStore",
    ]);
  });

  it("flags drift between manifest requires and factory requires", () => {
    const issues = auditExtensionContracts([
      input({
        manifestContracts: {
          provides: ["CacheStore"],
          requires: ["SchemaValidator"],
        },
        factoryRequires: ["OtherValidator"],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-cache/deno.json veryfront.contracts.requires differs from factory contracts: manifest SchemaValidator; factory OtherValidator",
    ]);
  });
});

describe("importWithRetry", () => {
  it("retries transient remote import failures", async () => {
    let attempts = 0;
    const mod = await importWithRetry("file:///extension.ts", {
      importModule: (url) => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError(
            "Import 'https://esm.sh/tailwindcss@4.2.2' failed: 522 <unknown status code>",
          );
        }
        return Promise.resolve({ default: () => ({}) });
      },
      delay: () => Promise.resolve(),
      retries: 1,
    });

    assertEquals(attempts, 2);
    assertEquals(typeof mod.default, "function");
  });

  it("does not retry local import failures", async () => {
    let attempts = 0;
    const error = await importWithRetry("file:///extension.ts", {
      importModule: () => {
        attempts += 1;
        throw new TypeError("Module not found: file:///extension.ts");
      },
      delay: () => Promise.resolve(),
      retries: 2,
    }).then(
      () => undefined,
      (caught) => caught,
    );

    assertEquals(attempts, 1);
    assertEquals(error instanceof TypeError, true);
  });
});
