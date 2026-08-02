/**
 * Dynamic factory loader.
 *
 * Loads an extension factory from a filesystem path by dynamic import,
 * invokes it, and wraps the result as a `ResolvedExtension`.
 *
 * @module extensions/factory-loader
 */

import { isAbsolute, toFileUrl } from "#veryfront/compat/path";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { EXTENSION_VALIDATION_ERROR } from "./errors.ts";
import { quoteDiagnosticString } from "./diagnostic-string.ts";
import {
  type BoundExtensionEntrypoint,
  revalidateBoundExtensionEntrypoint,
} from "./entrypoint-identity.ts";
import type { Extension, ExtensionFactory, ExtensionSource, ResolvedExtension } from "./types.ts";

type ImportMetaResolver = (specifier: string) => string;

interface ImportResolutionCapabilities {
  readonly resolver?: ImportMetaResolver;
  readonly runtime: "node" | "other";
}

const importMetaResolve = typeof import.meta.resolve === "function"
  ? import.meta.resolve
  : undefined;
const nativeImportResolution: ImportResolutionCapabilities = Object.freeze({
  ...(importMetaResolve === undefined ? {} : { resolver: importMetaResolve }),
  runtime: isNode ? "node" : "other",
});
const reflectApply = Reflect.apply;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** @internal Verify that a canonical file URL is not redirected by runtime resolution. */
export function assertCanonicalExtensionImport(
  specifier: string,
  path: string,
  capabilities: ImportResolutionCapabilities = nativeImportResolution,
): void {
  // Node does not expose an import-map facility that can redirect an absolute
  // file URL. DNT can also inject an import.meta.resolve ponyfill that delegates
  // to require.resolve(), which cannot resolve file URLs at all.
  // Runtime identity is therefore the stable capability boundary here.
  if (capabilities.runtime === "node") return;

  const resolver = capabilities.resolver;
  if (resolver === undefined) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `The current runtime cannot verify extension import target ${
        quoteDiagnosticString(path)
      }`,
    });
  }

  let resolvedSpecifier: string;
  try {
    resolvedSpecifier = reflectApply(resolver, undefined, [specifier]) as string;
  } catch (error) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Failed to resolve extension import target ${quoteDiagnosticString(path)}: ${
        quoteDiagnosticString(errorMessage(error))
      }`,
      cause: error,
    });
  }
  if (resolvedSpecifier !== specifier) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension import target ${
        quoteDiagnosticString(path)
      } was remapped from its canonical file URL and was not imported`,
    });
  }
}

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
 * @param binding Internal filesystem identity captured during discovery.
 */
export async function loadExtensionFactory(
  path: string,
  source: ExtensionSource,
  config?: unknown,
  binding?: BoundExtensionEntrypoint,
): Promise<ResolvedExtension> {
  if (binding) {
    if (binding.path !== path) {
      throw EXTENSION_VALIDATION_ERROR.create({
        detail: `Extension discovery binding does not match import target ${
          quoteDiagnosticString(path)
        }`,
      });
    }
    try {
      await revalidateBoundExtensionEntrypoint(binding);
    } catch (error) {
      throw EXTENSION_VALIDATION_ERROR.create({
        detail: `Extension import target ${
          quoteDiagnosticString(path)
        } failed identity revalidation: ${quoteDiagnosticString(errorMessage(error))}`,
        cause: error,
      });
    }
  }

  const absoluteTarget = isAbsolute(path);
  const specifier = absoluteTarget ? toFileUrl(path).href : path;
  if (absoluteTarget) {
    assertCanonicalExtensionImport(specifier, path);
  }

  let mod: { default?: unknown };
  try {
    mod = await import(specifier);
  } catch (err) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Failed to import extension at ${quoteDiagnosticString(path)}: ${
        quoteDiagnosticString(errorMessage(err))
      }`,
      cause: err,
    });
  }

  const factory = mod.default;
  if (factory === undefined || factory === null) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension at ${quoteDiagnosticString(path)} has no default export`,
    });
  }

  if (typeof factory !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension at ${
        quoteDiagnosticString(path)
      } default export is not a function (got ${typeof factory})`,
    });
  }

  let extension: Extension;
  try {
    extension = (factory as ExtensionFactory)(config);
  } catch (err) {
    throw EXTENSION_VALIDATION_ERROR.create({
      detail: `Extension factory at ${quoteDiagnosticString(path)} threw during invocation: ${
        quoteDiagnosticString(errorMessage(err))
      }`,
      cause: err,
    });
  }

  return { extension, source, origin: path };
}
