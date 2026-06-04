import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  auditExtensionContracts,
  type ExtensionContractAuditInput,
} from "./audit-extension-contracts.ts";
import { extractExtensionSourceMetadata } from "./extension-source-metadata.ts";

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

describe("extractExtensionSourceMetadata contracts", () => {
  it("extracts factory contract metadata from source without importing the extension module", () => {
    const metadata = extractExtensionSourceMetadata(`
      import "https://esm.sh/transient-package";
      const ext = () => ({
        contracts: {
          provides: ["CSSProcessor"],
          requires: ["SchemaValidator"],
        },
        capabilities: [],
      });
    `);

    assertEquals(metadata.contracts, {
      provides: ["CSSProcessor"],
      requires: ["SchemaValidator"],
    });
  });

  it("extracts legacy provider object keys when the source has no contracts block", () => {
    const metadata = extractExtensionSourceMetadata(`
      const ext = () => ({
        capabilities: [{ type: "net:outbound", hosts: ["*"] }],
        provides: {
          AuthProvider: provider,
        },
      });
    `);

    assertEquals(metadata.legacyProvides, ["AuthProvider"]);
  });

  it("resolves known exported contract name constants in contract arrays", () => {
    const metadata = extractExtensionSourceMetadata(`
      import {
        LLMProviderRegistryName,
        SandboxShellToolsProviderName,
      } from "veryfront/extensions/sandbox";
      const ext = () => ({
        contracts: {
          provides: [SandboxShellToolsProviderName],
          requires: [LLMProviderRegistryName],
        },
        capabilities: [],
      });
    `);

    assertEquals(metadata.contracts?.provides, ["SandboxShellToolsProvider"]);
    assertEquals(metadata.contracts?.requires, ["LLMProviderRegistry"]);
  });
});
