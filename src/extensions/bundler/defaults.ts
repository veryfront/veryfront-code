import { register, tryResolve } from "../contracts.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "../first-party-import.ts";
import type { Bundler } from "./bundler.ts";
import type { ModuleLexer } from "./module-lexer.ts";

type ZeroArgumentConstructor<T> = new () => T;

const DEFAULT_BUNDLER_EXTENSION_PACKAGE = "@veryfront/ext-bundler-esbuild";

function isMissingDefaultBundlerExtension(error: unknown): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    DEFAULT_BUNDLER_EXTENSION_PACKAGE,
  ]);
}

function isConstructor<T>(
  value: unknown,
): value is ZeroArgumentConstructor<T> {
  if (typeof value !== "function") return false;
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

function getDefaultBundlerConstructor<T>(
  extensionModule: unknown,
  exportName: "EsbuildBundler" | "EsModuleLexer",
): ZeroArgumentConstructor<T> {
  if (
    extensionModule === null ||
    (typeof extensionModule !== "object" && typeof extensionModule !== "function")
  ) {
    throw new TypeError(
      `Invalid ${DEFAULT_BUNDLER_EXTENSION_PACKAGE} module: expected a module namespace`,
    );
  }

  let candidate: unknown;
  try {
    candidate = (extensionModule as Record<string, unknown>)[exportName];
  } catch (cause) {
    throw new TypeError(
      `Invalid ${DEFAULT_BUNDLER_EXTENSION_PACKAGE} module: could not read export "${exportName}"`,
      { cause },
    );
  }

  if (!isConstructor<T>(candidate)) {
    throw new TypeError(
      `Invalid ${DEFAULT_BUNDLER_EXTENSION_PACKAGE} module: export "${exportName}" must be constructible`,
    );
  }
  return candidate;
}

function assertRequiredMethods(
  instance: unknown,
  exportName: "EsbuildBundler" | "EsModuleLexer",
  methodNames: readonly string[],
): void {
  for (const methodName of methodNames) {
    let method: unknown;
    try {
      method = (instance as Record<string, unknown>)[methodName];
    } catch (cause) {
      throw new TypeError(
        `Invalid ${DEFAULT_BUNDLER_EXTENSION_PACKAGE} module: "${exportName}" instance could not expose method "${methodName}"`,
        { cause },
      );
    }
    if (typeof method !== "function") {
      throw new TypeError(
        `Invalid ${DEFAULT_BUNDLER_EXTENSION_PACKAGE} module: "${exportName}" instance must implement method "${methodName}"`,
      );
    }
  }
}

function registerDefaultBundlerModule(extensionModule: unknown): void {
  const needsBundler = tryResolve<Bundler>("Bundler") === undefined;
  const needsModuleLexer = tryResolve<ModuleLexer>("ModuleLexer") === undefined;
  if (!needsBundler && !needsModuleLexer) return;

  const EsbuildBundler = needsBundler
    ? getDefaultBundlerConstructor<Bundler>(
      extensionModule,
      "EsbuildBundler",
    )
    : undefined;
  const EsModuleLexer = needsModuleLexer
    ? getDefaultBundlerConstructor<ModuleLexer>(
      extensionModule,
      "EsModuleLexer",
    )
    : undefined;

  const bundler = EsbuildBundler === undefined ? undefined : new EsbuildBundler();
  if (bundler !== undefined) {
    assertRequiredMethods(bundler, "EsbuildBundler", ["bundle", "transform"]);
  }
  const moduleLexer = EsModuleLexer === undefined ? undefined : new EsModuleLexer();
  if (moduleLexer !== undefined) {
    assertRequiredMethods(moduleLexer, "EsModuleLexer", ["parse"]);
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
  if (tryResolve("Bundler") && tryResolve("ModuleLexer")) return;

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
