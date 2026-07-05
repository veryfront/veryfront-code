import { register, tryResolve } from "../contracts.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "../first-party-import.ts";
import type { Bundler } from "./bundler.ts";
import type { ModuleLexer } from "./module-lexer.ts";

type DefaultBundlerModule = {
  EsbuildBundler: new () => Bundler;
  EsModuleLexer: new () => ModuleLexer;
};

/**
 * Lazily register the first-party Bundler + ModuleLexer implementation when it
 * is available from workspace source or an installed @veryfront/ext package.
 */
export async function ensureDefaultBundlerContracts(): Promise<void> {
  if (tryResolve("Bundler") && tryResolve("ModuleLexer")) return;

  try {
    const { EsbuildBundler, EsModuleLexer } = await importFirstPartyExtensionModule<
      DefaultBundlerModule
    >(
      "ext-bundler-esbuild",
      "@veryfront/ext-bundler-esbuild",
    );

    if (!tryResolve("Bundler")) register("Bundler", new EsbuildBundler());
    if (!tryResolve("ModuleLexer")) register("ModuleLexer", new EsModuleLexer());
  } catch (error) {
    if (!isMissingFirstPartyExtensionModule(error)) throw error;
  }
}
