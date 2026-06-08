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
  VeryfrontError,
} from "#veryfront/errors";
import { getTailwindPluginBundleUrl } from "#veryfront/build/binary-plugin-includes.ts";
import {
  bareName,
  PACKAGE_SPEC_RE,
  TAILWIND_PLUGIN_ALLOWLIST,
} from "./tailwind-plugin-allowlist.ts";

const logger = serverLogger.component("tailwind");

/**
 * Enforce the Tailwind plugin allowlist (VULN-FS-1).
 *
 * Called at the top of every entry point that can load third-party plugin
 * code. Rejects anything that is not a syntactically valid npm package
 * specifier, and anything whose bare name is not on the allowlist.
 */
function assertPluginAllowed(spec: string): void {
  if (!PACKAGE_SPEC_RE.test(spec)) {
    throw new Error(`Invalid Tailwind plugin specifier: ${spec}`);
  }
  const name = bareName(spec);
  if (!TAILWIND_PLUGIN_ALLOWLIST.has(name)) {
    throw new Error(
      `Package "${name}" is not on the Tailwind plugin allowlist. ` +
        `See src/html/styles-builder/tailwind-plugin-allowlist.ts.`,
    );
  }
}

// Provide localStorage shim for plugins that use util-deprecate (which checks localStorage)
// This prevents "LocalStorage is not supported in this context" errors in Deno.
try {
  void (globalThis as Record<string, unknown>).localStorage;
} catch {
  const localStorageShim = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageShim,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// Global shims for `tailwindcss/plugin`, `tailwindcss/defaultTheme`, and
// `tailwindcss/colors` used by dynamically loaded plugin bundles are installed
// by the `@veryfront/ext-css-tailwind` extension's `setup()` hook — they depend on
// tailwindcss imports that live in the extension package, not in core.

function isRealDenoRuntime(): boolean {
  const global = globalThis as {
    Bun?: unknown;
    process?: { versions?: { node?: string; deno?: string } };
  };
  const isNodeLike = global.process?.versions?.node != null && !global.process?.versions?.deno;

  return !global.Bun &&
    !isNodeLike &&
    typeof Deno !== "undefined" &&
    typeof Deno.version === "object" &&
    typeof Deno.build === "object" &&
    typeof Deno.build.os === "string";
}

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
  if (!isRealDenoRuntime()) {
    const dataUrl = `data:text/javascript;base64,${encodeToBase64(code)}`;
    return await import(dataUrl);
  }

  const tempPath = await Deno.makeTempFile({ prefix: "vf_tw_plugin_", suffix: ".mjs" });
  await Deno.writeTextFile(tempPath, code);
  logger.debug("Wrote plugin to temp file", { path: tempPath });

  try {
    return await import(`file://${tempPath}`);
  } finally {
    await Deno.remove(tempPath).catch((error) => {
      logger.error("Failed to clean up temp plugin file", {
        path: tempPath,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * Dynamically load a module from esm.sh in a compiled Deno binary.
 *
 * Works around the limitation that compiled Deno binaries cannot do
 * dynamic imports from URLs. Fetches bundled code, rewrites imports, loads via temp file.
 */
export async function loadModuleFromEsmSh(packageName: string): Promise<unknown> {
  assertPluginAllowed(packageName);

  const stubUrl = getTailwindPluginBundleUrl(packageName);
  logger.debug("Fetching esm.sh stub", { url: stubUrl });

  const stubResponse = await fetch(stubUrl);
  if (!stubResponse.ok) {
    throw NETWORK_ERROR.create({ detail: `Failed to fetch stub: ${stubResponse.status}` });
  }
  const stubCode = await stubResponse.text();

  const bundleMatch = stubCode.match(/from\s*["'](\/[^"']+\.bundle\.mjs)["']/);
  if (!bundleMatch) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: `Could not find bundle path in esm.sh response: ${stubCode.substring(0, 200)}`,
    });
  }

  const bundleUrl = `https://esm.sh${bundleMatch[1]}`;
  logger.debug("Fetching actual bundle", { url: bundleUrl });

  const bundleResponse = await fetch(bundleUrl);
  if (!bundleResponse.ok) {
    throw NETWORK_ERROR.create({ detail: `Failed to fetch bundle: ${bundleResponse.status}` });
  }
  let code = await bundleResponse.text();
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
  // never be served from a pre-seeded or stale cache entry — defence-in-depth
  // against future changes that might pre-populate these maps.
  assertPluginAllowed(id);

  const cachedError = pluginErrors.get(id);
  if (cachedError) throw cachedError;

  if (pluginCache.has(id)) {
    return pluginCache.get(id);
  }

  const { isDeno } = await import("#veryfront/platform/compat/runtime.ts");

  try {
    let mod: unknown;

    if (isDeno) {
      logger.debug("Loading plugin via dynamic esm.sh fetch", { id });
      mod = await loadModuleFromEsmSh(id);
    } else {
      logger.debug("Loading plugin from node_modules", { id });
      try {
        mod = await import(id);
      } catch {
        logger.debug("Plugin not found in node_modules, falling back to esm.sh", { id });
        mod = await loadModuleFromEsmSh(id);
      }
    }

    const pluginExport = (mod as { default?: unknown }).default ?? mod;
    pluginCache.set(id, pluginExport);
    return pluginExport;
  } catch (error) {
    const wrappedError = wrapPluginError(id, error);
    logger.warn(wrappedError.message);
    pluginErrors.set(id, wrappedError);
    throw wrappedError;
  }
}

function wrapPluginError(id: string, error: unknown): Error {
  const detail = `Failed to load plugin "${id}": ${
    error instanceof Error ? error.message : String(error)
  }`;

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
