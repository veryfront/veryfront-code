import { register, tryResolve } from "../contracts.ts";
import { EXTENSION_VALIDATION_ERROR } from "../errors.ts";
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

const DEFAULT_BUNDLER_SPECIFIER_FRAGMENTS = [
  "extensions/ext-bundler-esbuild/src/index",
  "@veryfront/ext-bundler-esbuild",
] as const;

/** @internal Classify only failures for the optional bundler module itself. */
export function isMissingDefaultBundlerImplementation(error: unknown): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    ...DEFAULT_BUNDLER_SPECIFIER_FRAGMENTS,
  ]);
}

function invalidDefaultBundlerImplementation(): never {
  throw EXTENSION_VALIDATION_ERROR.create({
    message: "The default bundler implementation is invalid",
  });
}

/** @internal Validate one dynamically imported default implementation module. */
export function createDefaultBundlerContracts(
  imported: unknown,
): { bundler: Bundler; lexer: ModuleLexer } {
  try {
    if (
      imported === null ||
      (typeof imported !== "object" && typeof imported !== "function")
    ) return invalidDefaultBundlerImplementation();
    const EsbuildBundler = Reflect.get(imported, "EsbuildBundler");
    const EsModuleLexer = Reflect.get(imported, "EsModuleLexer");
    if (typeof EsbuildBundler !== "function" || typeof EsModuleLexer !== "function") {
      return invalidDefaultBundlerImplementation();
    }

    const bundlerValue = Reflect.construct(EsbuildBundler, []) as Record<string, unknown>;
    const lexerValue = Reflect.construct(EsModuleLexer, []) as Record<string, unknown>;
    const bundle = Reflect.get(bundlerValue, "bundle");
    const transform = Reflect.get(bundlerValue, "transform");
    const context = Reflect.get(bundlerValue, "context");
    const stop = Reflect.get(bundlerValue, "stop");
    const init = Reflect.get(lexerValue, "init");
    const parse = Reflect.get(lexerValue, "parse");
    if (
      typeof bundle !== "function" || typeof transform !== "function" ||
      (context !== undefined && typeof context !== "function") ||
      (stop !== undefined && typeof stop !== "function") ||
      (init !== undefined && typeof init !== "function") ||
      typeof parse !== "function"
    ) return invalidDefaultBundlerImplementation();

    return {
      bundler: {
        bundle: bundle.bind(bundlerValue),
        transform: transform.bind(bundlerValue),
        ...(context === undefined ? {} : { context: context.bind(bundlerValue) }),
        ...(stop === undefined ? {} : { stop: stop.bind(bundlerValue) }),
      },
      lexer: {
        ...(init === undefined ? {} : { init: init.bind(lexerValue) }),
        parse: parse.bind(lexerValue),
      },
    };
  } catch {
    return invalidDefaultBundlerImplementation();
  }
}

/**
 * Lazily register the first-party Bundler + ModuleLexer implementation when it
 * is available from workspace source or an installed @veryfront/ext package.
 */
export async function ensureDefaultBundlerContracts(): Promise<void> {
  if (tryResolve("Bundler") !== undefined && tryResolve("ModuleLexer") !== undefined) return;

  try {
    const imported = await importFirstPartyExtensionModule<
      DefaultBundlerModule
    >(
      "ext-bundler-esbuild",
      "@veryfront/ext-bundler-esbuild",
    );
    const { bundler, lexer } = createDefaultBundlerContracts(imported);

    if (tryResolve("Bundler") === undefined) register("Bundler", bundler);
    if (tryResolve("ModuleLexer") === undefined) register("ModuleLexer", lexer);
  } catch (error) {
    if (!isMissingDefaultBundlerImplementation(error)) throw error;
  }
}
