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
import type { Extension, ExtensionFactory, ExtensionSource, ResolvedExtension } from "./types.ts";

/**
 * Dynamically import an extension factory from `path` and resolve it.
 *
 * `path` may be either an absolute filesystem path (for project and
 * local-file sources) or a bare module specifier (for `package` source).
 * Absolute paths are converted to `file://` URLs; bare specifiers are
 * passed through so the runtime's module resolver can find them.
 *
 * The module must `export default` an `ExtensionFactory` (a function that
 * returns an `Extension`). On any error — missing default export, default
 * export that is not a function, factory throw, or import failure — this
 * throws `EXTENSION_VALIDATION_ERROR` with a `detail` field that names the
 * path and what went wrong.
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
  const specifier = isAbsolute(path) ? toFileUrl(path).href : path;
  let mod: { default?: unknown };
  try {
    mod = await import(specifier);
  } catch (err) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Failed to import extension at "${path}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      cause: err,
    });
  }

  const factory = mod.default;
  if (factory === undefined || factory === null) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension at "${path}" has no default export`,
    });
  }

  if (typeof factory !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension at "${path}" default export is not a function (got ${typeof factory})`,
    });
  }

  let extension: Extension;
  try {
    extension = (factory as ExtensionFactory)(config);
  } catch (err) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension factory at "${path}" threw during invocation: ${
        err instanceof Error ? err.message : String(err)
      }`,
      cause: err,
    });
  }

  return { extension, source, origin: path };
}
