import { assertEquals, assertRejects } from "#std/assert";
import { dirname, join } from "#std/path";
import { describe, it } from "#std/testing/bdd";
import {
  auditExtensionContracts,
  auditExtensionContractWorkspace,
  type ExtensionContractAuditInput,
} from "./audit-extension-contracts.ts";
import {
  extractExtensionSourceMetadata,
  extractExtensionSourceMetadataFromFile,
  MAX_EXTENSION_METADATA_CONTRACT_REFERENCES,
  MAX_EXTENSION_METADATA_IMPORT_MAPPINGS,
  MAX_EXTENSION_METADATA_RESOLUTION_DEPTH,
  MAX_EXTENSION_METADATA_SOURCE_BYTES,
  MAX_EXTENSION_METADATA_WORKSPACE_FILES,
} from "./extension-source-metadata.ts";

interface StaticFixture {
  root: string;
  extensionDir: string;
  entryPath: string;
}

async function withStaticFixture(
  files: Readonly<Record<string, string>>,
  run: (fixture: StaticFixture) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir();
  const extensionDir = join(root, "extensions", "ext-static");
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.writeTextFile(target, source);
    }
    await run({
      root,
      extensionDir,
      entryPath: join(extensionDir, "src", "index.ts"),
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

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

  it("reports unresolved source metadata without a misleading drift issue", () => {
    const issues = auditExtensionContracts([
      input({
        factoryProvides: [],
        sourceResolutionIssues: [
          "contracts.provides[0] could not resolve ContractName: [binding-not-found] missing",
        ],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-cache/deno.json could not resolve factory contract metadata: contracts.provides[0] could not resolve ContractName: [binding-not-found] missing",
    ]);
  });

  it("rejects malformed manifest and factory contract lists before comparison", () => {
    const malformedManifest = auditExtensionContracts([
      input({
        manifestContracts: {
          provides: ["CacheStore", "CacheStore", " bad ", ""],
          requires: [],
        },
      }),
    ]);
    assertEquals(malformedManifest.map((issue) => issue.message), [
      'extensions/ext-cache/deno.json veryfront.contracts.provides[1] duplicates "CacheStore"',
      "extensions/ext-cache/deno.json veryfront.contracts.provides[2] must not have surrounding whitespace",
      "extensions/ext-cache/deno.json veryfront.contracts.provides[3] must be a non-empty string",
    ]);

    const malformedFactory = auditExtensionContracts([
      input({ factoryProvides: ["CacheStore", "CacheStore"] }),
    ]);
    assertEquals(malformedFactory.map((issue) => issue.message), [
      'extensions/ext-cache/deno.json factory contracts.provides[1] duplicates "CacheStore"',
    ]);

    const malformedContainer = auditExtensionContracts([
      input({ manifestContracts: null }),
    ]);
    assertEquals(malformedContainer.map((issue) => issue.message), [
      "extensions/ext-cache/deno.json veryfront.contracts must be an object",
    ]);
  });

  it("rejects hostile contract identifiers and oversized lists", () => {
    for (const name of ["A\nB", "A\u0085B", "A\u2028B", "A\uD800B"]) {
      const issues = auditExtensionContracts([
        input({
          manifestContracts: { provides: [name] },
          factoryProvides: [name],
        }),
      ]);
      assertEquals(issues.length >= 1, true);
    }

    const oversized = Array.from(
      { length: 257 },
      (_, index) => `Contract${index}`,
    );
    const issues = auditExtensionContracts([
      input({
        manifestContracts: { provides: oversized },
        factoryProvides: oversized,
      }),
    ]);
    assertEquals(
      issues.every((issue) =>
        issue.message.includes("must contain at most 256 entries")
      ),
      true,
    );
  });

  it("statically rejects hostile modern and legacy factory contract names", () => {
    for (const name of ["A\nB", "A\u0085B", "A\u2029B", "A\uD800B"]) {
      const modern = extractExtensionSourceMetadata(`
        export default () => ({
          capabilities: [],
          contracts: { provides: [${JSON.stringify(name)}] },
        });
      `);
      assertEquals(modern.contractResolutionIssues.length > 0, true);

      const legacy = extractExtensionSourceMetadata(`
        export default () => ({
          capabilities: [],
          provides: { [${JSON.stringify(name)}]: {} },
        });
      `);
      assertEquals(legacy.contractResolutionIssues.length > 0, true);
    }
  });

  it("normalizes malformed manifest failures without absolute paths", async () => {
    await withStaticFixture(
      { "extensions/ext-static/deno.json": "{" },
      async ({ root }) => {
        const issues = await auditExtensionContractWorkspace(root);
        assertEquals(issues.length, 1);
        assertEquals(
          issues[0]?.message,
          "extensions/ext-static/deno.json could not read extension manifest: [manifest-invalid-json] extensions/ext-static/deno.json: file is not valid JSON",
        );
        assertEquals(issues[0]?.message.includes(root), false);
      },
    );
  });

  it("reports ext-* discovery entries that are not real directories", async () => {
    const root = await Deno.makeTempDir();
    try {
      const extensionsDir = join(root, "extensions");
      await Deno.mkdir(join(extensionsDir, "target"), { recursive: true });
      await Deno.writeTextFile(join(extensionsDir, "ext-file"), "not a dir");
      await Deno.symlink(
        join(extensionsDir, "target"),
        join(extensionsDir, "ext-link"),
      );
      const issues = await auditExtensionContractWorkspace(root);
      assertEquals(issues.map((issue) => issue.message), [
        "extensions/ext-file/deno.json could not discover extension manifest: [extension-entry-not-directory] extension entry must be a directory",
        "extensions/ext-link/deno.json could not discover extension manifest: [extension-entry-symlink] extension entry must not be a symlink",
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("audits the manifest root export instead of a hardcoded index", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/deno.json": JSON.stringify({
          exports: "./src/runtime.ts",
          imports: {},
          veryfront: {
            capabilities: [],
            contracts: { provides: ["RuntimeContract"] },
          },
        }),
        "extensions/ext-static/src/index.ts": `
          export default () => ({
            contracts: { provides: ["IndexDecoy"] }, capabilities: [],
          });
        `,
        "extensions/ext-static/src/runtime.ts": `
          export default () => ({
            contracts: { provides: ["RuntimeContract"] }, capabilities: [],
          });
        `,
      },
      async ({ root }) => {
        assertEquals(await auditExtensionContractWorkspace(root), []);
      },
    );
  });

  it("rejects unsupported import-map scopes, external maps, and relative keys", async () => {
    for (
      const unsupported of [
        { scopes: { "./src/": { "vf/contracts": "./src/runtime.ts" } } },
        { importMap: "./import-map.json" },
        { imports: { "./src/contract.ts": "./src/runtime.ts" } },
        { imports: { "vf/contracts": "./%2e%2e/runtime.ts" } },
      ]
    ) {
      await withStaticFixture(
        {
          "extensions/ext-static/deno.json": JSON.stringify({
            exports: "./src/index.ts",
            imports: { "vf/contracts": "./src/manifest.ts" },
            ...unsupported,
            veryfront: {
              capabilities: [],
              contracts: { provides: ["ManifestContract"] },
            },
          }),
          "extensions/ext-static/src/index.ts": `
            import { ContractName } from "vf/contracts";
            export default () => ({
              contracts: { provides: [ContractName] }, capabilities: [],
            });
          `,
          "extensions/ext-static/src/manifest.ts":
            `export const ContractName = "ManifestContract";`,
          "extensions/ext-static/src/runtime.ts":
            `export const ContractName = "RuntimeContract";`,
        },
        async ({ root }) => {
          const issues = await auditExtensionContractWorkspace(root);
          assertEquals(issues.length, 1);
          assertEquals(
            issues[0]?.message.includes("[manifest-invalid-import-map]"),
            true,
          );
        },
      );
    }
  });

  it("rejects URL-sensitive direct and prefix-mapped source specifiers", async () => {
    for (
      const { sourceSpecifier, imports } of [
        { sourceSpecifier: "./%2e%2e/runtime.ts", imports: {} },
        { sourceSpecifier: "./runtime.ts?decoy=.ts", imports: {} },
        {
          sourceSpecifier: "vf/%72untime.ts",
          imports: { "vf/": "./src/" },
        },
        {
          sourceSpecifier: "vf/../runtime.ts",
          imports: { "vf/": "./src/" },
        },
      ]
    ) {
      await withStaticFixture(
        {
          "extensions/ext-static/src/index.ts": `
            import { ContractName } from ${JSON.stringify(sourceSpecifier)};
            export default () => ({
              contracts: { provides: [ContractName] }, capabilities: [],
            });
          `,
          "extensions/ext-static/runtime.ts":
            `export const ContractName = "Runtime";`,
          "extensions/ext-static/src/runtime.ts":
            `export const ContractName = "Runtime";`,
        },
        async ({ root, extensionDir, entryPath }) => {
          const metadata = await extractExtensionSourceMetadataFromFile({
            workspaceRoot: root,
            entryPath,
            importMapBaseDir: extensionDir,
            imports,
          });
          assertEquals(metadata.contracts, {});
          assertEquals(
            metadata.contractResolutionIssues.some((issue) =>
              issue.includes("unsupported URL/path syntax")
            ),
            true,
          );
        },
      );
    }
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
      export default ext;
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
      export default ext;
    `);

    assertEquals(metadata.legacyProvides, ["AuthProvider"]);
  });

  it("selects legacy provides from the exported factory and rejects spreads", () => {
    const selected = extractExtensionSourceMetadata(`
      const decoy = { provides: { WrongProvider: wrong } };
      export default () => ({
        capabilities: [],
        provides: { ["RightProvider"]: right },
      });
    `);
    assertEquals(selected.legacyProvides, ["RightProvider"]);
    assertEquals(selected.contractResolutionIssues, []);

    const spread = extractExtensionSourceMetadata(`
      const inherited = { HiddenProvider: hidden };
      export default () => ({
        capabilities: [],
        provides: { VisibleProvider: visible, ...inherited },
      });
    `);
    assertEquals(spread.legacyProvides, []);
    assertEquals(
      spread.contractResolutionIssues.some((issue) =>
        issue.includes("must not contain spreads")
      ),
      true,
    );

    const aliased = extractExtensionSourceMetadata(`
      const providers = { VisibleProvider: visible };
      const alias = providers;
      alias.HiddenProvider = hidden;
      export default () => ({ capabilities: [], provides: providers });
    `);
    assertEquals(aliased.legacyProvides, []);
    assertEquals(
      aliased.contractResolutionIssues.some((issue) =>
        issue.includes("inline object literal")
      ),
      true,
    );

    const missingFactory = extractExtensionSourceMetadata(`
      const metadata = { provides: { HiddenProvider: hidden } };
    `);
    assertEquals(missingFactory.legacyProvides, []);
    assertEquals(
      missingFactory.contractResolutionIssues.some((issue) =>
        issue.includes("no statically identifiable default extension factory")
      ),
      true,
    );
  });

  it("resolves local string constants without a static allowlist", () => {
    const metadata = extractExtensionSourceMetadata(`
      const unrelatedPattern = /{/u;
      const RequiredContract = "LLMProviderRegistry" as const;
      const ProvidedContract = "SandboxShellToolsProvider";
      const ext = () => ({
        contracts: {
          provides: [ProvidedContract],
          requires: [RequiredContract],
        },
        capabilities: [],
      });
      export default ext;
    `);

    assertEquals(metadata.contracts?.provides, ["SandboxShellToolsProvider"]);
    assertEquals(metadata.contracts?.requires, ["LLMProviderRegistry"]);
    assertEquals(metadata.contractResolutionIssues, []);
  });

  it("fails closed on unresolved and computed contract expressions", () => {
    const metadata = extractExtensionSourceMetadata(`
      const ext = () => ({
        contracts: {
          provides: [MissingContract, computeContract()],
        },
        capabilities: [],
      });
      export default ext;
    `);

    assertEquals(metadata.contracts, {});
    assertEquals(metadata.contractResolutionIssues, [
      "contracts.provides[0] could not resolve MissingContract: [binding-not-found] binding MissingContract was not found",
      "contracts.provides[1] uses an unsupported expression: contracts.provides[1] is CallExpression",
    ]);

    const dynamic = extractExtensionSourceMetadata(`
      const contractMetadata = { provides: ["HiddenContract"] };
      const ext = () => ({
        contracts: contractMetadata,
        capabilities: [],
      });
      export default ext;
    `);
    assertEquals(dynamic.contracts, {});
    assertEquals(
      dynamic.contractResolutionIssues.some((issue) =>
        issue.includes("must be an inline object literal")
      ),
      true,
    );

    const dynamicList = extractExtensionSourceMetadata(`
      const provided = ["HiddenContract"];
      const ext = () => ({
        contracts: { provides: provided },
        capabilities: [],
      });
      export default ext;
    `);
    assertEquals(dynamicList.contracts, {});
    assertEquals(dynamicList.contractResolutionIssues, [
      "contracts.provides[0] uses an unsupported expression: contracts.provides must be an inline array",
    ]);
  });

  it("uses the exported factory AST and ignores lexical decoys", () => {
    const metadata = extractExtensionSourceMetadata(`
      interface Decoy { contracts: { provides: ["TypeDecoy"] } }
      const regex = /contracts: { provides: ["RegexDecoy"] }/;
      const template = \`contracts: { provides: ["TemplateDecoy"] }\`;
      const unrelated = { contracts: { provides: ["ObjectDecoy"] } };
      const ext = () => ({
        name: "ext-real",
        version: "1.0.0",
        contracts: { provides: ["RuntimeContract"] },
        capabilities: [],
      });
      export default ext;
    `);

    assertEquals(metadata.contracts, { provides: ["RuntimeContract"] });
    assertEquals(metadata.contractResolutionIssues, []);
  });

  it("supports static property spellings and rejects partial initializers", () => {
    const staticMetadata = extractExtensionSourceMetadata(`
      export default () => ({
        name: "ext-static",
        version: "1.0.0",
        "contracts": { ["provides"]: ["ComputedLiteral"] },
        capabilities: [],
      });
    `);
    assertEquals(staticMetadata.contracts, {
      provides: ["ComputedLiteral"],
    });
    assertEquals(staticMetadata.contractResolutionIssues, []);

    for (
      const initializer of [
        '"Declared" + suffix',
        'condition ? "Declared" : "Other"',
        "Base.value",
        "Base.toString()",
      ]
    ) {
      const metadata = extractExtensionSourceMetadata(`
        const Base = "Base";
        const ContractName = ${initializer};
        export default () => ({
          name: "ext-computed",
          version: "1.0.0",
          contracts: { provides: [ContractName] },
          capabilities: [],
        });
      `);
      assertEquals(metadata.contracts, {});
      assertEquals(
        metadata.contractResolutionIssues.some((issue) =>
          issue.includes("[unsupported-expression]")
        ),
        true,
      );
    }
  });

  it("fails closed on spreads, conditional returns, holes, and invalid names", () => {
    const spread = extractExtensionSourceMetadata(`
      const override = { contracts: { provides: ["Runtime"] } };
      export default () => ({
        name: "ext-spread",
        version: "1.0.0",
        contracts: { provides: ["Manifest"] },
        capabilities: [],
        ...override,
      });
    `);
    assertEquals(
      spread.contractResolutionIssues.some((issue) =>
        issue.includes("must not use spreads")
      ),
      true,
    );

    const conditional = extractExtensionSourceMetadata(`
      export default (flag: boolean) => {
        if (flag) return { contracts: { provides: ["A"] }, capabilities: [] };
        return { contracts: { provides: ["B"] }, capabilities: [] };
      };
    `);
    assertEquals(
      conditional.contractResolutionIssues.some((issue) =>
        issue.includes("exactly one inline extension object")
      ),
      true,
    );

    const invalid = extractExtensionSourceMetadata(`
      export default () => ({
        contracts: { provides: [, "", " padded ", "Same", "Same"] },
        capabilities: [],
      });
    `);
    assertEquals(invalid.contractResolutionIssues.length, 4);
    assertEquals(
      invalid.contractResolutionIssues.some((issue) =>
        issue.includes("array hole")
      ),
      true,
    );
    assertEquals(
      invalid.contractResolutionIssues.some((issue) =>
        issue.includes("duplicates")
      ),
      true,
    );

    const aliasMutation = extractExtensionSourceMetadata(`
      const metadata = { contracts: { provides: ["Manifest"] } };
      const alias = metadata;
      alias.contracts = { provides: ["Runtime"] };
      export default () => ({
        contracts: metadata.contracts,
        capabilities: [],
      });
    `);
    assertEquals(aliasMutation.contracts, {});
    assertEquals(
      aliasMutation.contractResolutionIssues.some((issue) =>
        issue.includes("inline object literal")
      ),
      true,
    );

    for (
      const mutation of [
        'extension.contracts = { provides: ["Runtime"] };',
        'const alias = extension; alias.contracts = { provides: ["Runtime"] };',
        'Object.assign(extension, { contracts: { provides: ["Runtime"] } });',
        "mutate(extension);",
      ]
    ) {
      const factoryMutation = extractExtensionSourceMetadata(`
        const extension = () => ({
          contracts: { provides: ["Manifest"] }, capabilities: [],
        });
        ${mutation}
        export default extension;
      `);
      assertEquals(factoryMutation.contracts, {});
      assertEquals(
        factoryMutation.contractResolutionIssues.some((issue) =>
          issue.includes("additional references")
        ),
        true,
      );
    }

    const objectDescriptor = extractExtensionSourceMetadata(`
      const extension = {
        contracts: { provides: ["Manifest"] }, capabilities: [],
      };
      Object.assign(extension, {
        contracts: { provides: ["Runtime"] },
      });
      export default extension;
    `);
    assertEquals(objectDescriptor.contracts, {});
    assertEquals(
      objectDescriptor.contractResolutionIssues.some((issue) =>
        issue.includes("const function expression")
      ),
      true,
    );

    const functionDeclaration = extractExtensionSourceMetadata(`
      function extension() {
        return { contracts: { provides: ["Manifest"] }, capabilities: [] };
      }
      eval('extension = () => ({ contracts: { provides: ["Runtime"] }, capabilities: [] })');
      export default extension;
    `);
    assertEquals(functionDeclaration.contracts, {});
    assertEquals(
      functionDeclaration.contractResolutionIssues.some((issue) =>
        issue.includes("const function expression")
      ),
      true,
    );

    const aliasDeclarations = Array.from(
      { length: MAX_EXTENSION_METADATA_RESOLUTION_DEPTH + 2 },
      (_, index) =>
        index === 0
          ? `const factory0 = () => ({ contracts: { provides: ["A"] }, capabilities: [] });`
          : `const factory${index} = factory${index - 1};`,
    ).join("\n");
    const aliasChain = extractExtensionSourceMetadata(`
      ${aliasDeclarations}
      export default factory${MAX_EXTENSION_METADATA_RESOLUTION_DEPTH + 1};
    `);
    assertEquals(aliasChain.contracts, {});
    assertEquals(aliasChain.contractResolutionIssues.length > 0, true);

    const nestedOnly = extractExtensionSourceMetadata(`
      export default (flag: boolean) => {
        if (flag) return { contracts: { provides: ["A"] }, capabilities: [] };
      };
    `);
    assertEquals(nestedOnly.contracts, {});
    assertEquals(nestedOnly.contractResolutionIssues.length > 0, true);

    const extraBareReturn = extractExtensionSourceMetadata(`
      export default () => {
        return { contracts: { provides: ["A"] }, capabilities: [] };
        return;
      };
    `);
    assertEquals(extraBareReturn.contracts, {});
    assertEquals(extraBareReturn.contractResolutionIssues.length > 0, true);
  });

  it("rejects factory-local bindings that shadow contract constants", () => {
    for (
      const factory of [
        `(C = "Runtime") => ({
          contracts: { provides: [C] }, capabilities: [],
        })`,
        `({ C }: { C: string }) => ({
          contracts: { provides: [C] }, capabilities: [],
        })`,
        `(...C: string[]) => ({
          contracts: { provides: [C] }, capabilities: [],
        })`,
        `() => {
          const C = "Runtime";
          return { contracts: { provides: [C] }, capabilities: [] };
        }`,
        `() => {
          try { throw new Error("decoy"); } catch (C) { void C; }
          return { contracts: { provides: [C] }, capabilities: [] };
        }`,
      ]
    ) {
      const metadata = extractExtensionSourceMetadata(`
        const C = "Manifest";
        export default ${factory};
      `);
      assertEquals(metadata.contracts, {});
      assertEquals(
        metadata.contractResolutionIssues.some((issue) =>
          issue.includes("shadowed by a factory-local binding")
        ),
        true,
      );
    }
  });

  it("rejects mutable named, async, and generator default factories", () => {
    const named = extractExtensionSourceMetadata(`
      export default function extension() {
        return { contracts: { provides: ["Manifest"] }, capabilities: [] };
      }
      extension = () => ({
        contracts: { provides: ["Runtime"] }, capabilities: [],
      });
    `);
    assertEquals(named.contracts, {});
    assertEquals(
      named.contractResolutionIssues.some((issue) =>
        issue.includes("named default function declarations are mutable")
      ),
      true,
    );

    for (
      const factory of [
        `async () => ({ contracts: { provides: ["A"] }, capabilities: [] })`,
        `function* () {
          return { contracts: { provides: ["A"] }, capabilities: [] };
        }`,
      ]
    ) {
      const metadata = extractExtensionSourceMetadata(
        `export default ${factory};`,
      );
      assertEquals(metadata.contracts, {});
      assertEquals(
        metadata.contractResolutionIssues.some((issue) =>
          issue.includes("synchronous and non-generator")
        ),
        true,
      );
      assertEquals(
        metadata.capabilityResolutionIssues.some((issue) =>
          issue.includes("synchronous and non-generator")
        ),
        true,
      );
    }
  });

  it("rejects prototype-mutating metadata literals", () => {
    for (
      const source of [
        `export default () => ({
          __proto__: { contracts: { provides: ["Runtime"] } },
          capabilities: [],
        });`,
        `export default () => ({
          contracts: {
            __proto__: { provides: ["Runtime"] },
          },
          capabilities: [],
        });`,
        `export default () => ({
          provides: {
            __proto__: { Runtime: {} },
          },
          capabilities: [],
        });`,
      ]
    ) {
      const metadata = extractExtensionSourceMetadata(source);
      assertEquals(metadata.contracts?.provides, undefined);
      assertEquals(
        metadata.contractResolutionIssues.some((issue) =>
          issue.includes("must not declare __proto__")
        ),
        true,
      );
    }
  });

  it("rejects mixed modern and legacy provider declarations", () => {
    const metadata = extractExtensionSourceMetadata(`
      export default () => ({
        contracts: { provides: ["Declared"] },
        provides: { Hidden: {} },
        capabilities: [],
      });
    `);
    assertEquals(metadata.contracts, {});
    assertEquals(metadata.legacyProvides, []);
    assertEquals(
      metadata.contractResolutionIssues.some((issue) =>
        issue.includes("must not mix contracts with legacy provides")
      ),
      true,
    );
  });
});

describe("file-aware extension contract resolution", () => {
  it("rejects CommonJS source extensions outside the ESM audit grammar", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.cjs":
          `module.exports = () => ({ contracts: {}, capabilities: [] });`,
      },
      async ({ root, extensionDir }) => {
        await assertRejects(
          () =>
            extractExtensionSourceMetadataFromFile({
              workspaceRoot: root,
              entryPath: join(extensionDir, "src", "index.cjs"),
              importMapBaseDir: extensionDir,
              imports: {},
            }),
          TypeError,
          "unsupported source extension",
        );
      },
    );
  });

  it("follows manifest-mapped named imports and re-export barrels without execution", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { PublicContract as ContractAlias } from "veryfront/contracts";
          throw new Error("extension source must never execute during audit");
          export default () => ({
            contracts: { provides: [ContractAlias] },
            capabilities: [],
          });
        `,
        "core/barrel.ts": `
          export { InternalContract as PublicContract } from "./contract.ts";
        `,
        "core/contract.ts": `
          const InternalContract = "ResolvedContract" as const;
          export { InternalContract };
        `,
      },
      async ({ root, extensionDir, entryPath }) => {
        const metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../core/barrel.ts",
          },
        });

        assertEquals(metadata.contracts, { provides: ["ResolvedContract"] });
        assertEquals(metadata.contractResolutionIssues, []);
      },
    );
  });

  it("resolves export-star barrels when exactly one local export matches", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { ContractName } from "veryfront/contracts";
          export default () => ({
            contracts: { provides: [ContractName] },
            capabilities: [],
          });
        `,
        "core/barrel.ts": `export * from "./contract.ts";`,
        "core/contract.ts": `export const ContractName = "StarContract";`,
      },
      async ({ root, extensionDir, entryPath }) => {
        const metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../core/barrel.ts",
          },
        });
        assertEquals(metadata.contracts, { provides: ["StarContract"] });
        assertEquals(metadata.contractResolutionIssues, []);
      },
    );
  });

  it("rejects ambiguous star exports even when their values match", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { ContractName } from "veryfront/contracts";
          export default () => ({
            contracts: { provides: [ContractName] },
            capabilities: [],
          });
        `,
        "core/barrel.ts": `
          export * from "./a.ts";
          export * from "./b.ts";
        `,
        "core/a.ts": `export const ContractName = "SameValue";`,
        "core/b.ts": `export const ContractName = "SameValue";`,
      },
      async ({ root, extensionDir, entryPath }) => {
        const metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../core/barrel.ts",
          },
        });
        assertEquals(
          metadata.contractResolutionIssues.some((issue) =>
            issue.includes("[ambiguous-binding]")
          ),
          true,
        );
      },
    );
  });

  it("enforces exact import-map paths and prefix trailing-slash semantics", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { ContractName } from "vf/contracts/value.ts";
          export default () => ({
            contracts: { provides: [ContractName] },
            capabilities: [],
          });
        `,
        "core/value.ts": `export const ContractName = "ExactPrefix";`,
        "corevalue.ts": `export const ContractName = "WronglyJoined";`,
      },
      async ({ root, extensionDir, entryPath }) => {
        const invalidPrefix = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: { "vf/contracts/": "../../core" },
        });
        assertEquals(
          invalidPrefix.contractResolutionIssues.some((issue) =>
            issue.includes("[invalid-import-mapping]")
          ),
          true,
        );

        const validPrefix = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: { "vf/contracts/": "../../core/" },
        });
        assertEquals(validPrefix.contracts, { provides: ["ExactPrefix"] });
        assertEquals(validPrefix.contractResolutionIssues, []);
      },
    );
  });

  it("rejects import cycles and mappings that escape the workspace", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { CyclicContract, EscapedContract } from "veryfront/contracts";
          export default () => ({
            contracts: { provides: [CyclicContract, EscapedContract] },
            capabilities: [],
          });
        `,
        "core/a.ts": `export { CyclicContract } from "./b.ts";`,
        "core/b.ts": `export { CyclicContract } from "./a.ts";`,
      },
      async ({ root, extensionDir, entryPath }) => {
        const cyclic = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../core/a.ts",
          },
        });
        assertEquals(
          cyclic.contractResolutionIssues.some((issue) =>
            issue.includes("[cycle]")
          ),
          true,
        );

        const escaped = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../../../outside.ts",
          },
        });
        assertEquals(escaped.contractResolutionIssues.length, 2);
        assertEquals(
          escaped.contractResolutionIssues.every((issue) =>
            issue.includes("[path-outside-workspace]")
          ),
          true,
        );
      },
    );
  });

  it("enforces source-size and resolution-depth bounds", async () => {
    const depthFiles: Record<string, string> = {
      "extensions/ext-static/src/index.ts": `
        import { ContractName } from "veryfront/contracts";
        export default () => ({
          contracts: { provides: [ContractName] },
          capabilities: [],
        });
      `,
    };
    for (
      let index = 0;
      index <= MAX_EXTENSION_METADATA_RESOLUTION_DEPTH;
      index += 1
    ) {
      depthFiles[`core/depth-${index}.ts`] = index ===
          MAX_EXTENSION_METADATA_RESOLUTION_DEPTH
        ? `export const ContractName = "TooDeep";`
        : `export { ContractName } from "./depth-${index + 1}.ts";`;
    }

    await withStaticFixture(
      depthFiles,
      async ({ root, extensionDir, entryPath }) => {
        const metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../core/depth-0.ts",
          },
        });
        assertEquals(
          metadata.contractResolutionIssues.some((issue) =>
            issue.includes("[depth-limit]")
          ),
          true,
        );
      },
    );

    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { ContractName } from "veryfront/contracts";
          export default () => ({
            contracts: { provides: [ContractName] },
            capabilities: [],
          });
        `,
        "core/oversized.ts": `export const ContractName = "Oversized";\n${
          " ".repeat(MAX_EXTENSION_METADATA_SOURCE_BYTES)
        }`,
      },
      async ({ root, extensionDir, entryPath }) => {
        const metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: {
            "veryfront/contracts": "../../core/oversized.ts",
          },
        });
        assertEquals(
          metadata.contractResolutionIssues.some((issue) =>
            issue.includes("[source-too-large]")
          ),
          true,
        );
      },
    );
  });

  it("keeps depth results independent of contract reference order", async () => {
    const files: Record<string, string> = {
      "extensions/ext-static/src/index.ts": "",
      "core/barrel.ts": `
        export { ContractName as Direct } from "./common.ts";
        export { ContractName as Long } from "./long-0.ts";
      `,
      "core/common.ts": `export const ContractName = "Shared";`,
    };
    for (let index = 0; index < 14; index += 1) {
      files[`core/long-${index}.ts`] = index === 13
        ? `export { ContractName } from "./common.ts";`
        : `export { ContractName } from "./long-${index + 1}.ts";`;
    }
    await withStaticFixture(
      files,
      async ({ root, extensionDir, entryPath }) => {
        const inspect = async (references: string) => {
          await Deno.writeTextFile(
            entryPath,
            `
              import { Direct, Long } from "veryfront/contracts";
              export default () => ({
                contracts: { provides: [${references}] },
                capabilities: [],
              });
            `,
          );
          return await extractExtensionSourceMetadataFromFile({
            workspaceRoot: root,
            entryPath,
            importMapBaseDir: extensionDir,
            imports: { "veryfront/contracts": "../../core/barrel.ts" },
          });
        };
        const directFirst = await inspect("Direct, Long");
        const longFirst = await inspect("Long, Direct");
        assertEquals(directFirst.contracts, { provides: ["Shared"] });
        assertEquals(longFirst.contracts, { provides: ["Shared"] });
        assertEquals(
          directFirst.contractResolutionIssues.map((issue) =>
            issue.replace(/provides\[[01]\]/, "provides[index]")
          ),
          longFirst.contractResolutionIssues.map((issue) =>
            issue.replace(/provides\[[01]\]/, "provides[index]")
          ),
        );
        assertEquals(
          directFirst.contractResolutionIssues.every((issue) =>
            issue.includes("[depth-limit]")
          ),
          true,
        );
      },
    );
  });

  it("rejects invalid UTF-8 and intermediate source symlinks", async () => {
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { ContractName } from "veryfront/contracts";
          export default () => ({
            contracts: { provides: [ContractName] }, capabilities: [],
          });
        `,
        "core/contract.ts": `export const ContractName = "Valid";`,
      },
      async ({ root, extensionDir, entryPath }) => {
        const contractPath = join(root, "core", "contract.ts");
        await Deno.writeFile(contractPath, new Uint8Array([0xff]));
        let metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: { "veryfront/contracts": "../../core/contract.ts" },
        });
        assertEquals(
          metadata.contractResolutionIssues.some((issue) =>
            issue.includes("source is not valid UTF-8")
          ),
          true,
        );

        await Deno.remove(contractPath);
        const target = join(root, "core", "target.ts");
        await Deno.writeTextFile(
          target,
          `export const ContractName = "Target";`,
        );
        await Deno.symlink(target, contractPath);
        metadata = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: { "veryfront/contracts": "../../core/contract.ts" },
        });
        assertEquals(
          metadata.contractResolutionIssues.some((issue) =>
            issue.includes("[source-symlink]")
          ),
          true,
        );
      },
    );
  });

  it("accepts exact source, mapping, and reference limits and rejects one over", async () => {
    const contractModule = `export const ContractName = "AtLimit";`;
    await withStaticFixture(
      {
        "extensions/ext-static/src/index.ts": `
          import { ContractName } from "veryfront/contracts";
          export default () => ({
            contracts: { provides: [ContractName] }, capabilities: [],
          });
        `,
        "core/contract.ts": contractModule +
          " ".repeat(
            MAX_EXTENSION_METADATA_SOURCE_BYTES - contractModule.length,
          ),
      },
      async ({ root, extensionDir, entryPath }) => {
        const exactMappings: Record<string, string> = {
          "veryfront/contracts": "../../core/contract.ts",
        };
        for (
          let index = 1;
          index < MAX_EXTENSION_METADATA_IMPORT_MAPPINGS;
          index += 1
        ) exactMappings[`unused-${index}`] = "../../core/contract.ts";
        const exact = await extractExtensionSourceMetadataFromFile({
          workspaceRoot: root,
          entryPath,
          importMapBaseDir: extensionDir,
          imports: exactMappings,
        });
        assertEquals(exact.contracts, { provides: ["AtLimit"] });
        assertEquals(exact.contractResolutionIssues, []);

        exactMappings.extra = "../../core/contract.ts";
        let rejected = false;
        try {
          await extractExtensionSourceMetadataFromFile({
            workspaceRoot: root,
            entryPath,
            importMapBaseDir: extensionDir,
            imports: exactMappings,
          });
        } catch (error) {
          rejected = error instanceof TypeError &&
            error.message.includes("imports exceeds");
        }
        assertEquals(rejected, true);
      },
    );

    const exactNames = Array.from(
      { length: MAX_EXTENSION_METADATA_CONTRACT_REFERENCES },
      (_, index) => `"Contract${index}"`,
    );
    const exact = extractExtensionSourceMetadata(`
      export default () => ({
        contracts: { provides: [${exactNames.join(",")}] }, capabilities: [],
      });
    `);
    assertEquals(
      exact.contracts?.provides?.length,
      MAX_EXTENSION_METADATA_CONTRACT_REFERENCES,
    );
    assertEquals(exact.contractResolutionIssues, []);
    const oneOver = extractExtensionSourceMetadata(`
      export default () => ({
        contracts: { provides: [${exactNames.join(",")}, "Extra"] },
        capabilities: [],
      });
    `);
    assertEquals(
      oneOver.contractResolutionIssues.some((issue) =>
        issue.includes("exceeds")
      ),
      true,
    );
  });

  it("bounds aggregate source parsing across a workspace", async () => {
    const root = await Deno.makeTempDir();
    try {
      for (
        let index = 0;
        index <= MAX_EXTENSION_METADATA_WORKSPACE_FILES;
        index += 1
      ) {
        const name = `ext-${String(index).padStart(3, "0")}`;
        const extensionDir = join(root, "extensions", name);
        await Deno.mkdir(join(extensionDir, "src"), { recursive: true });
        await Deno.writeTextFile(
          join(extensionDir, "deno.json"),
          JSON.stringify({
            exports: "./src/index.ts",
            imports: {},
            veryfront: { capabilities: [], contracts: {} },
          }),
        );
        await Deno.writeTextFile(
          join(extensionDir, "src", "index.ts"),
          `export default () => ({ contracts: {}, capabilities: [] });`,
        );
      }
      const issues = await auditExtensionContractWorkspace(root);
      assertEquals(issues.length, 1);
      assertEquals(
        issues[0]?.message.includes("[workspace-file-limit]"),
        true,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
