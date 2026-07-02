/**
 * Resolve first-party extension implementations without making the root npm
 * package statically depend on every extension dependency.
 *
 * Source and compiled-binary builds can load the workspace extension sources.
 * npm builds should load the separate @veryfront/ext-* packages installed by
 * the consuming service or app.
 */

const SOURCE_EXTENSION_ROOT = "../../extensions";

export function firstPartyExtensionSourceSpecifiers(sourceDirectory: string): string[] {
  const sourceRoot = `${SOURCE_EXTENSION_ROOT}/${sourceDirectory}/src/index`;
  return [`${sourceRoot}.ts`, `${sourceRoot}.js`];
}

export async function importFirstPartyExtensionModule<TModule>(
  sourceDirectory: string,
  packageName: string,
): Promise<TModule> {
  const sourceFragment = `extensions/${sourceDirectory}/src/index`;
  let sourceError: unknown;

  for (const sourceSpecifier of firstPartyExtensionSourceSpecifiers(sourceDirectory)) {
    try {
      return await import(sourceSpecifier) as TModule;
    } catch (error) {
      if (!isMissingFirstPartyExtensionModule(error, [sourceFragment])) {
        throw error;
      }
      sourceError ??= error;
    }
  }

  try {
    return await import(packageName) as TModule;
  } catch (error) {
    if (!isMissingFirstPartyExtensionModule(error, [packageName])) {
      throw error;
    }
    throw withMissingExtensionInstallHint(error, sourceDirectory, packageName, sourceError);
  }
}

// Stable runtime error codes for unresolvable modules (preferred over message
// text, which runtimes reword between releases).
const MISSING_MODULE_ERROR_CODES = new Set([
  "ERR_MODULE_NOT_FOUND", // Node ESM
  "MODULE_NOT_FOUND", // Node CJS interop
]);

// Message fallback for runtimes that do not attach a code (Deno module
// resolution, deno compile's embedded-module errors, import-map misses).
const MISSING_MODULE_MESSAGE_PATTERNS = [
  "Cannot find package",
  "Cannot find module",
  "ERR_MODULE_NOT_FOUND",
  "Module not found",
  "not a dependency and not in import map",
] as const;

/**
 * Classify a dynamic-import failure as "the extension module itself is not
 * installed" as opposed to a real load failure inside an installed extension.
 *
 * Checks the stable `error.code` first and falls back to message patterns,
 * walking the `cause` chain so wrapped errors classify like their root cause.
 *
 * When `expectedSpecifierFragments` is provided, the specifier the runtime
 * quotes as missing must reference one of the fragments. This keeps a broken
 * transitive dependency (e.g. `Cannot find package 'jose'` thrown while
 * loading an installed @veryfront/ext-auth-jwt) from being misread as
 * "extension not installed" and silently skipped.
 */
export function isMissingFirstPartyExtensionModule(
  error: unknown,
  expectedSpecifierFragments?: string[],
): boolean {
  const chain = errorChain(error);
  const missing = chain.filter(isMissingModuleError);
  if (missing.length === 0) return false;
  if (!expectedSpecifierFragments || expectedSpecifierFragments.length === 0) return true;

  for (const entry of missing) {
    const missingSpecifier = errorMessage(entry).match(/["']([^"']+)["']/)?.[1];
    if (!missingSpecifier) continue;
    return expectedSpecifierFragments.some((fragment) => missingSpecifier.includes(fragment));
  }
  // Missing-module error with no quotable specifier: keep the previous
  // fail-open behavior so unknown message shapes still degrade gracefully.
  return true;
}

function isMissingModuleError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && MISSING_MODULE_ERROR_CODES.has(code)) return true;

  const message = errorMessage(error);
  return MISSING_MODULE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern)) ||
    (message.includes("Import '") && message.includes("' failed"));
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 8) {
    if (chain.includes(current)) break;
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Both the workspace source and the npm package are missing. Surface the
 * package-resolution error (its message names the installable @veryfront/ext-*
 * package) instead of the internal workspace source path, and append an
 * explicit install hint for npm consumers.
 */
function withMissingExtensionInstallHint(
  error: unknown,
  sourceDirectory: string,
  packageName: string,
  sourceError: unknown,
): unknown {
  if (!(error instanceof Error)) return error;
  error.message +=
    ` First-party extension "${sourceDirectory}" is not installed; install ${packageName} alongside veryfront to enable it.`;
  if (error.cause === undefined && sourceError !== undefined && sourceError !== error) {
    error.cause = sourceError;
  }
  return error;
}
