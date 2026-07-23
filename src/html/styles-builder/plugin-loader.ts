/**
 * Tailwind CSS plugin loading for compiled Deno binaries.
 *
 * Handles dynamic loading of Tailwind plugins from esm.sh with
 * import rewriting for compiled binary compatibility.
 *
 * @module html/styles-builder/plugin-loader
 */

import { serverLogger } from "#veryfront/utils";
import {
  type ErrorSlug,
  getErrorBySlug,
  IMPORT_RESOLUTION_ERROR,
  NETWORK_ERROR,
  SECURITY_VIOLATION,
  VeryfrontError,
} from "#veryfront/errors";
import { getTailwindPluginBundleUrl } from "#veryfront/build/binary-plugin-includes.ts";
import { getDenoRuntime, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { join, toFileUrl } from "#veryfront/platform/compat/path/index.ts";
import {
  bareName,
  PACKAGE_SPEC_RE,
  resolveApprovedTailwindPluginSpecifier,
  TAILWIND_PLUGIN_ALLOWLIST,
} from "./tailwind-plugin-allowlist.ts";
import { readResponseTextWithinLimit } from "./bounded-response-reader.ts";

const logger = serverLogger.component("tailwind");
const MAX_PLUGIN_SPEC_LENGTH = 256;
const MAX_PLUGIN_STUB_BYTES = 64 * 1024;
const MAX_PLUGIN_BUNDLE_BYTES = 8 * 1024 * 1024;
const PLUGIN_FETCH_TIMEOUT_MS = 15_000;
const MAX_PLUGIN_CACHE_ENTRIES = 64;

/**
 * Enforce the Tailwind plugin allowlist (VULN-FS-1).
 *
 * Called at the top of every entry point that can load third-party plugin
 * code. Rejects anything that is not a syntactically valid npm package
 * specifier, and anything whose bare name is not on the allowlist.
 */
function assertPluginAllowed(spec: string): string {
  if (spec.length > MAX_PLUGIN_SPEC_LENGTH || !PACKAGE_SPEC_RE.test(spec)) {
    throw SECURITY_VIOLATION.create({ detail: `Invalid Tailwind plugin specifier: ${spec}` });
  }
  const name = bareName(spec);
  if (!TAILWIND_PLUGIN_ALLOWLIST.has(name)) {
    throw SECURITY_VIOLATION.create({
      detail: `Package "${name}" is not on the Tailwind plugin allowlist.`,
    });
  }

  const approvedSpecifier = resolveApprovedTailwindPluginSpecifier(spec);
  if (!approvedSpecifier) {
    throw SECURITY_VIOLATION.create({
      detail: `Package "${name}" is not an approved Tailwind plugin version.`,
    });
  }
  return approvedSpecifier;
}

// Global shims for `tailwindcss/plugin`, `tailwindcss/defaultTheme`, and
// `tailwindcss/colors` used by dynamically loaded plugin bundles are installed
// by the `@veryfront/ext-css-tailwind` extension's `setup()` hook. They depend on
// tailwindcss imports that live in the extension package, not in core.

function encodeToBase64(source: string): string {
  const bufferCtor = (globalThis as {
    Buffer?: {
      from: (input: string, encoding: string) => { toString: (encoding: string) => string };
    };
  }).Buffer;

  if (bufferCtor?.from) {
    return bufferCtor.from(source, "utf8").toString("base64");
  }

  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * esm.sh bundles can contain root-relative nested imports. Once the bundle is
 * written to a temp file, Deno resolves those as local file paths unless they
 * are normalized back to esm.sh URLs.
 */
export function rewriteEsmShRootRelativeImports(code: string): string {
  return code
    .replace(
      /\b(from\s*)(["'])(\/(?!\/)[^"']+)\2/g,
      (_match, prefix: string, quote: string, specifier: string) =>
        `${prefix}${quote}https://esm.sh${specifier}${quote}`,
    )
    .replace(
      /\b(import\s*)(["'])(\/(?!\/)[^"']+)\2/g,
      (_match, prefix: string, quote: string, specifier: string) =>
        `${prefix}${quote}https://esm.sh${specifier}${quote}`,
    )
    .replace(
      /\b(import\s*\(\s*)(["'])(\/(?!\/)[^"']+)\2/g,
      (_match, prefix: string, quote: string, specifier: string) =>
        `${prefix}${quote}https://esm.sh${specifier}${quote}`,
    );
}

async function importBundledModule(code: string): Promise<unknown> {
  if (!isDeno) {
    const dataUrl = `data:text/javascript;base64,${encodeToBase64(code)}`;
    return await import(dataUrl);
  }

  const deno = getDenoRuntime();
  if (!deno) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: "Deno runtime was expected while importing a Tailwind plugin module",
    });
  }

  const tempDir = await deno.makeTempDir({ prefix: "vf_tw_plugin_" });
  const tempPath = join(tempDir, "plugin.mjs");
  await deno.writeTextFile(tempPath, code);

  try {
    return await import(toFileUrl(tempPath).href);
  } finally {
    await deno.remove(tempDir, { recursive: true }).catch((error) => {
      logger.error("Failed to clean up temp plugin directory", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }
}

async function fetchPluginText(
  url: string,
  resource: "stub" | "bundle",
  maxBytes: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLUGIN_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw NETWORK_ERROR.create({
        detail: `Failed to fetch ${resource}: ${response.status}`,
      });
    }

    return await readResponseTextWithinLimit(
      response,
      maxBytes,
      () =>
        IMPORT_RESOLUTION_ERROR.create({
          detail: `Tailwind plugin ${resource} exceeds the size limit`,
        }),
    );
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    if (controller.signal.aborted) {
      throw NETWORK_ERROR.create({ detail: `Tailwind plugin ${resource} request timed out` });
    }
    throw NETWORK_ERROR.create({
      detail: `Tailwind plugin ${resource} request failed`,
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Dynamically load a module from esm.sh in a compiled Deno binary.
 *
 * Works around the limitation that compiled Deno binaries cannot do
 * dynamic imports from URLs. Fetches bundled code, rewrites imports, loads via temp file.
 */
export async function loadModuleFromEsmSh(packageName: string): Promise<unknown> {
  const approvedPackageName = assertPluginAllowed(packageName);

  const stubUrl = getTailwindPluginBundleUrl(approvedPackageName);
  const stubCode = await fetchPluginText(stubUrl, "stub", MAX_PLUGIN_STUB_BYTES);

  const bundleMatch = stubCode.match(/from\s*["'](\/[^"']+\.bundle\.mjs)["']/);
  if (!bundleMatch) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: "Could not find bundle path in esm.sh response",
    });
  }

  const bundleUrl = new URL(bundleMatch[1]!, "https://esm.sh");
  if (bundleUrl.origin !== "https://esm.sh" || bundleUrl.username || bundleUrl.password) {
    throw IMPORT_RESOLUTION_ERROR.create({ detail: "esm.sh returned an invalid bundle path" });
  }
  let code = await fetchPluginText(bundleUrl.href, "bundle", MAX_PLUGIN_BUNDLE_BYTES);
  code = rewriteEsmShRootRelativeImports(code);

  // Step 3: Verify it's actually JavaScript (not an HTML error page)
  if (code.trimStart().startsWith("<!") || code.trimStart().startsWith("<html")) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: `esm.sh returned HTML instead of JavaScript for ${packageName}`,
    });
  }

  // Step 4: Rewrite tailwindcss imports to use global shims
  const shimMap: Record<string, string> = {
    "tailwindcss/plugin": "__tailwindPluginShim",
    "tailwindcss/defaultTheme": "__tailwindDefaultThemeShim",
    "tailwindcss/colors": "__tailwindColorsShim",
  };

  for (const [importPath, shimName] of Object.entries(shimMap)) {
    const importRegex = new RegExp(
      `import\\*as\\s+(__\\d+\\$)\\s+from["']${importPath.replace("/", "\\/")}["']`,
      "g",
    );
    code = code.replace(importRegex, (_, varName) => {
      logger.debug(`Rewrote ${importPath} import to use global shim`, { varName });
      return `const ${varName} = globalThis.${shimName}`;
    });
  }

  // Step 4b: Patch out localStorage access from util-deprecate
  code = code.replace(
    /globalThis\.localStorage/g,
    "(globalThis.__localStorageShim||(globalThis.__localStorageShim={getItem:()=>null,setItem:()=>{},length:0}))",
  );

  return await importBundledModule(code);
}

export async function loadPlugin(
  id: string,
  pluginCache: Map<string, unknown>,
  pluginErrors: Map<string, Error>,
): Promise<unknown> {
  // Enforce the allowlist before consulting any caches so a disallowed id can
  // never be served from a pre-seeded or stale cache entry. This is defense in
  // depth against future changes that might pre-populate these maps.
  assertPluginAllowed(id);

  const cachedError = pluginErrors.get(id);
  if (cachedError) throw cachedError;

  if (pluginCache.has(id)) {
    return await pluginCache.get(id);
  }

  if (pluginCache.size >= MAX_PLUGIN_CACHE_ENTRIES) {
    throw IMPORT_RESOLUTION_ERROR.create({ detail: "Tailwind plugin cache capacity reached" });
  }

  const loadPromise = (async () => {
    let mod: unknown;

    if (isDeno) {
      mod = await loadModuleFromEsmSh(id);
    } else {
      try {
        mod = await import(id);
      } catch {
        mod = await loadModuleFromEsmSh(id);
      }
    }

    return (mod as { default?: unknown }).default ?? mod;
  })();
  pluginCache.set(id, loadPromise);

  try {
    const pluginExport = await loadPromise;
    if (pluginCache.get(id) === loadPromise) pluginCache.set(id, pluginExport);
    return pluginExport;
  } catch (error) {
    if (pluginCache.get(id) === loadPromise) pluginCache.delete(id);
    const wrappedError = wrapPluginError(id, error);
    logger.warn("Tailwind plugin load failed", {
      errorName: wrappedError.name,
    });
    if (pluginErrors.size >= MAX_PLUGIN_CACHE_ENTRIES) {
      const oldest = pluginErrors.keys().next().value;
      if (oldest) pluginErrors.delete(oldest);
    }
    pluginErrors.set(id, wrappedError);
    throw wrappedError;
  }
}

function wrapPluginError(id: string, error: unknown): Error {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const detail = `Failed to load plugin "${id}" (${errorName})`;

  if (error instanceof VeryfrontError) {
    return getErrorBySlug(error.slug as ErrorSlug).create({
      detail,
      cause: error.cause,
      context: error.context,
      instance: error.instance,
      status: error.status,
    });
  }

  if (error instanceof Error) {
    return new Error(detail, { cause: error });
  }

  return IMPORT_RESOLUTION_ERROR.create({ detail });
}
