/**
 * Tailwind CSS plugin loading for compiled Deno binaries.
 *
 * Handles dynamic loading of Tailwind plugins from esm.sh with
 * import rewriting for compiled binary compatibility.
 *
 * @module html/styles-builder/plugin-loader
 */

import plugin from "tailwindcss/plugin";
import defaultTheme from "tailwindcss/defaultTheme";
import colors from "tailwindcss/colors";
import { serverLogger as logger } from "#veryfront/utils";

// Provide localStorage shim for plugins that use util-deprecate (which checks localStorage)
// This prevents "LocalStorage is not supported in this context" errors in Deno.
try {
  // deno-lint-ignore no-explicit-any
  const _test = (globalThis as any).localStorage;
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

// Set up global shims for tailwindcss subpaths - used by dynamically loaded plugins
(globalThis as Record<string, unknown>).__tailwindPluginShim = {
  default: plugin,
  __esModule: true,
};
(globalThis as Record<string, unknown>).__tailwindDefaultThemeShim = {
  default: defaultTheme,
  __esModule: true,
};
(globalThis as Record<string, unknown>).__tailwindColorsShim = {
  default: colors,
  __esModule: true,
};

/**
 * Dynamically load a module from esm.sh in a compiled Deno binary.
 *
 * Works around the limitation that compiled Deno binaries cannot do
 * dynamic imports from URLs. Fetches bundled code, rewrites imports, loads via temp file.
 */
export async function loadModuleFromEsmSh(packageName: string): Promise<unknown> {
  const stubUrl = `https://esm.sh/${packageName}?bundle&external=tailwindcss&target=denonext`;
  logger.debug("[tailwind] Fetching esm.sh stub", { url: stubUrl });

  const stubResponse = await fetch(stubUrl);
  if (!stubResponse.ok) {
    throw new Error(`Failed to fetch stub: ${stubResponse.status}`);
  }
  const stubCode = await stubResponse.text();

  const bundleMatch = stubCode.match(/from\s*["'](\/[^"']+\.bundle\.mjs)["']/);
  if (!bundleMatch) {
    throw new Error(`Could not find bundle path in esm.sh response: ${stubCode.substring(0, 200)}`);
  }

  const bundleUrl = `https://esm.sh${bundleMatch[1]}`;
  logger.debug("[tailwind] Fetching actual bundle", { url: bundleUrl });

  const bundleResponse = await fetch(bundleUrl);
  if (!bundleResponse.ok) {
    throw new Error(`Failed to fetch bundle: ${bundleResponse.status}`);
  }
  let code = await bundleResponse.text();

  // Step 3: Verify it's actually JavaScript (not an HTML error page)
  if (code.trimStart().startsWith("<!") || code.trimStart().startsWith("<html")) {
    throw new Error(`esm.sh returned HTML instead of JavaScript for ${packageName}`);
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
      logger.debug(`[tailwind] Rewrote ${importPath} import to use global shim`, { varName });
      return `const ${varName} = globalThis.${shimName}`;
    });
  }

  // Step 4b: Patch out localStorage access from util-deprecate
  code = code.replace(
    /globalThis\.localStorage/g,
    "(globalThis.__localStorageShim||(globalThis.__localStorageShim={getItem:()=>null,setItem:()=>{},length:0}))",
  );

  // Step 5: Write to temp file and import
  const tempPath = `/tmp/tw_plugin_${crypto.randomUUID()}.mjs`;
  await Deno.writeTextFile(tempPath, code);
  logger.debug("[tailwind] Wrote plugin to temp file", { path: tempPath });

  try {
    return await import(`file://${tempPath}`);
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

export async function loadPlugin(
  id: string,
  pluginCache: Map<string, unknown>,
  pluginErrors: Map<string, string>,
): Promise<unknown> {
  if (pluginCache.has(id)) {
    const errorMsg = pluginErrors.get(id);
    if (errorMsg) throw new Error(errorMsg);
    return pluginCache.get(id);
  }

  const { isDeno } = await import("#veryfront/platform/compat/runtime.ts");

  try {
    let mod: unknown;

    if (isDeno) {
      logger.debug("[tailwind] Loading plugin via dynamic esm.sh fetch", { id });
      mod = await loadModuleFromEsmSh(id);
    } else {
      logger.debug("[tailwind] Loading plugin from node_modules", { id });
      try {
        mod = await import(id);
      } catch {
        const errorMsg = `Failed to load plugin "${id}": plugin not installed`;
        logger.warn("[tailwind] Plugin not installed", { id });
        pluginErrors.set(id, errorMsg);
        pluginCache.set(id, null);
        throw new Error(errorMsg);
      }
    }

    const pluginExport = (mod as { default?: unknown }).default ?? mod;
    pluginCache.set(id, pluginExport);
    return pluginExport;
  } catch (error) {
    const errorMsg = `Failed to load plugin "${id}": ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.warn(`[tailwind] ${errorMsg}`);
    pluginErrors.set(id, errorMsg);
    throw new Error(errorMsg);
  }
}
