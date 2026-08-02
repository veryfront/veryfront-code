import { register, tryResolve } from "../contracts.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "../first-party-import.ts";
import { assertRequiredMethods, getConstructibleModuleExport } from "../runtime-validation.ts";
import type { Bundler } from "./bundler.ts";
import type { ModuleLexer } from "./module-lexer.ts";

const DEFAULT_BUNDLER_EXTENSION_PACKAGE = "@veryfront/ext-bundler-esbuild";

function isMissingDefaultBundlerExtension(error: unknown): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    DEFAULT_BUNDLER_EXTENSION_PACKAGE,
  ]);
}

function registerDefaultBundlerModule(extensionModule: unknown): void {
  const needsBundler = tryResolve<Bundler>("Bundler") === undefined;
  const needsModuleLexer = tryResolve<ModuleLexer>("ModuleLexer") === undefined;
  if (!needsBundler && !needsModuleLexer) return;

  const EsbuildBundler = needsBundler
    ? getConstructibleModuleExport<Bundler>(
      extensionModule,
      DEFAULT_BUNDLER_EXTENSION_PACKAGE,
      "EsbuildBundler",
    )
    : undefined;
  const EsModuleLexer = needsModuleLexer
    ? getConstructibleModuleExport<ModuleLexer>(
      extensionModule,
      DEFAULT_BUNDLER_EXTENSION_PACKAGE,
      "EsModuleLexer",
    )
    : undefined;

  const bundler = EsbuildBundler === undefined ? undefined : new EsbuildBundler();
  if (bundler !== undefined) {
    assertRequiredMethods(
      bundler,
      DEFAULT_BUNDLER_EXTENSION_PACKAGE,
      "EsbuildBundler",
      ["bundle", "transform"],
    );
  }
  const moduleLexer = EsModuleLexer === undefined ? undefined : new EsModuleLexer();
  if (moduleLexer !== undefined) {
    assertRequiredMethods(
      moduleLexer,
      DEFAULT_BUNDLER_EXTENSION_PACKAGE,
      "EsModuleLexer",
      ["parse"],
    );
  }

  // Construct and validate every missing implementation before mutating the
  // process-global registry. Recheck after constructors run so extension code
  // cannot overwrite an implementation registered during initialization.
  if (bundler !== undefined && tryResolve<Bundler>("Bundler") === undefined) {
    register("Bundler", bundler);
  }
  if (
    moduleLexer !== undefined &&
    tryResolve<ModuleLexer>("ModuleLexer") === undefined
  ) {
    register("ModuleLexer", moduleLexer);
  }
}

/** @internal Test-only seams; this module is not a public package entry point. */
export const defaultBundlerContractsInternals = Object.freeze({
  isMissingDefaultBundlerExtension,
  registerDefaultBundlerModule,
});

/**
 * Lazily register the first-party Bundler + ModuleLexer implementation when it
 * is available from workspace source or an installed @veryfront/ext package.
 */
export async function ensureDefaultBundlerContracts(): Promise<void> {
  if (
    tryResolve("Bundler") !== undefined &&
    tryResolve("ModuleLexer") !== undefined
  ) return;

  let extensionModule: unknown;
  try {
    extensionModule = await importFirstPartyExtensionModule<unknown>(
      "ext-bundler-esbuild",
      DEFAULT_BUNDLER_EXTENSION_PACKAGE,
    );
  } catch (error) {
    if (!isMissingDefaultBundlerExtension(error)) throw error;
    return;
  }

  registerDefaultBundlerModule(extensionModule);
}
