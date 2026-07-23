/**
 * Dynamic factory loader.
 *
 * Loads an extension factory from a filesystem path by dynamic import,
 * invokes it, and wraps the result as a `ResolvedExtension`.
 *
 * @module extensions/factory-loader
 */

import { isAbsolute, toFileUrl } from "@std/path";
import { EXTENSION_VALIDATION_ERROR } from "./errors.ts";
import { hasControlCharacters } from "./identifiers.ts";
import type { Extension, ExtensionFactory, ExtensionSource, ResolvedExtension } from "./types.ts";
import { validateExtension } from "./validation.ts";

const VALID_EXTENSION_SOURCES = new Set<ExtensionSource>([
  "config",
  "package",
  "project",
  "local-file",
  "builtin",
]);
const MAX_EXTENSION_SPECIFIER_LENGTH = 4_096;
const PACKAGE_SPECIFIER_PATTERN =
  /^(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Dynamically import an extension factory from `path` and resolve it.
 *
 * `path` may be either an absolute filesystem path (for project and
 * local-file sources) or a bare module specifier (for `package` source).
 * Absolute paths are converted to `file://` URLs; bare specifiers are
 * passed through so the runtime's module resolver can find them.
 *
 * The module must `export default` an `ExtensionFactory` (a function that
 * returns an `Extension`). Import, export-shape, factory, and result-validation
 * failures throw `EXTENSION_VALIDATION_ERROR`. Errors identify the failed
 * stage without exposing local paths or raw extension failures.
 *
 * @param path Absolute filesystem path or bare module specifier.
 * @param source Where the extension was discovered (drives merge priority).
 * @param config Optional config forwarded to the factory.
 */
export async function loadExtensionFactory(
  path: string,
  source: ExtensionSource,
  config?: unknown,
): Promise<ResolvedExtension> {
  if (
    typeof path !== "string" || path.length === 0 ||
    path.length > MAX_EXTENSION_SPECIFIER_LENGTH ||
    hasControlCharacters(path)
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension module specifier is invalid",
    });
  }
  if (!VALID_EXTENSION_SOURCES.has(source)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension source is invalid",
    });
  }
  const absolutePath = isAbsolute(path);
  const barePackageSpecifier = !absolutePath && PACKAGE_SPECIFIER_PATTERN.test(path);
  const specifierMatchesSource = source === "package"
    ? barePackageSpecifier
    : source === "project" || source === "local-file"
    ? absolutePath
    : absolutePath || barePackageSpecifier;
  if (!specifierMatchesSource) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension module specifier is invalid for its source",
    });
  }

  const specifier = absolutePath ? toFileUrl(path).href : path;
  let mod: { default?: unknown };
  try {
    mod = await import(specifier);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Failed to import extension",
    });
  }

  const factory = mod.default;
  if (factory === undefined || factory === null) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension module has no default export",
    });
  }

  if (typeof factory !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension module default export is not a function",
    });
  }

  let extension: unknown;
  try {
    extension = (factory as ExtensionFactory)(config);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension factory failed during initialization",
    });
  }

  const issues = validateExtension(extension);
  if (issues.length > 0) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension factory returned an invalid extension:\n  ${issues.join("\n  ")}`,
    });
  }

  return { extension: extension as Extension, source, origin: path };
}
