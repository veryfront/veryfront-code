import { register, tryResolve } from "veryfront/extensions/contracts";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";

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
