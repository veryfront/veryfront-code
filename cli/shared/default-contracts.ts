import { register, tryResolve } from "veryfront/extensions/contracts";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "veryfront/extensions/parser";

export async function ensureCliSchemaValidator(): Promise<void> {
  if (tryResolve("SchemaValidator")) return;

  const { createZodAdapter } = await importFirstPartyExtensionModule<{
    createZodAdapter: () => unknown;
  }>("ext-schema-zod", "@veryfront/ext-schema-zod");
  register("SchemaValidator", createZodAdapter());
}

export async function ensureCliBundlerContracts(): Promise<void> {
  if (tryResolve("Bundler") && tryResolve("ModuleLexer")) return;

  const { EsbuildBundler, EsModuleLexer } = await importFirstPartyExtensionModule<{
    EsbuildBundler: new () => unknown;
    EsModuleLexer: new () => unknown;
  }>("ext-bundler-esbuild", "@veryfront/ext-bundler-esbuild").catch((error) => {
    throw new Error(
      `Veryfront CLI requires @veryfront/ext-bundler-esbuild for bundling. Install @veryfront/ext-bundler-esbuild alongside veryfront. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  if (!tryResolve("Bundler")) register("Bundler", new EsbuildBundler());
  if (!tryResolve("ModuleLexer")) register("ModuleLexer", new EsModuleLexer());
}

/** Ensure standalone CLI Skill commands have an explicit YAML implementation. */
export async function ensureCliSkillDocumentParser(): Promise<
  Readonly<SkillDocumentParserProvider>
> {
  const existing = tryResolve<SkillDocumentParserProvider>(
    SkillDocumentParserProviderName,
  );
  if (existing !== undefined) {
    return snapshotSkillDocumentParserProvider(existing);
  }

  const { createStdYamlSkillDocumentParserProvider } = await importFirstPartyExtensionModule<{
    createStdYamlSkillDocumentParserProvider: () => Readonly<
      SkillDocumentParserProvider
    >;
  }>("ext-yaml", "@veryfront/ext-yaml");
  const registeredDuringImport = tryResolve<SkillDocumentParserProvider>(
    SkillDocumentParserProviderName,
  );
  if (registeredDuringImport !== undefined) {
    return snapshotSkillDocumentParserProvider(registeredDuringImport);
  }

  const created = snapshotSkillDocumentParserProvider(
    createStdYamlSkillDocumentParserProvider(),
  );
  register(
    SkillDocumentParserProviderName,
    created,
  );
  return created;
}
