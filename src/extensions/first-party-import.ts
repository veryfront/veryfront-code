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
  const message = error instanceof Error ? error.message : String(error);
  const matchesMissingModulePattern =
    MISSING_MODULE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern)) ||
    (message.includes("Import '") && message.includes("' failed"));
  if (!matchesMissingModulePattern) return false;
  if (!expectedSpecifierFragments || expectedSpecifierFragments.length === 0) return true;

  const missingSpecifier = message.match(/["']([^"']+)["']/)?.[1];
  if (!missingSpecifier) return true;
  return expectedSpecifierFragments.some((fragment) => missingSpecifier.includes(fragment));
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
