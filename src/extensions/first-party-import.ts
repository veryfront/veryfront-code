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
  let sourceError: unknown;

  for (const sourceSpecifier of firstPartyExtensionSourceSpecifiers(sourceDirectory)) {
    try {
      return await import(sourceSpecifier) as TModule;
    } catch (error) {
      if (!isMissingFirstPartyExtensionModule(error)) {
        throw error;
      }
      sourceError ??= error;
    }
  }

  try {
    return await import(packageName) as TModule;
  } catch (error) {
    if (!isMissingFirstPartyExtensionModule(error)) {
      throw error;
    }
    throw sourceError ?? error;
  }
}

export function isMissingFirstPartyExtensionModule(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("Module not found") ||
    message.includes("Module not found in the included modules") ||
    message.includes("not a dependency and not in import map") ||
    message.includes("Import '") && message.includes("' failed");
}
