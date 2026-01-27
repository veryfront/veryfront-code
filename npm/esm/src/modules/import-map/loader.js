import { rendererLogger as logger } from "../../utils/index.js";
import { dirname, join } from "../../platform/compat/path/index.js";
import { getConfig } from "../../config/index.js";
import { getDefaultImportMap } from "./default-import-map.js";
import { mergeImportMaps } from "./merger.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { getReactImportMap } from "../../transforms/esm/package-registry.js";
function normalizeImportMapForRuntime(importMap) {
    const normalizeValue = (value) => {
        if (!value.startsWith("npm:"))
            return value;
        // Convert npm: specifiers to esm.sh URLs (should not happen with new code)
        const spec = value.slice(4);
        const [base, query] = spec.split("?");
        const url = `https://esm.sh/${base}`;
        return query ? `${url}?${query}` : `${url}?target=es2022`;
    };
    let imports = importMap.imports
        ? Object.fromEntries(Object.entries(importMap.imports).map(([k, v]) => [k, normalizeValue(v)]))
        : undefined;
    const scopes = importMap.scopes
        ? Object.fromEntries(Object.entries(importMap.scopes).map(([scope, mappings]) => [
            scope,
            Object.fromEntries(Object.entries(mappings).map(([k, v]) => [k, normalizeValue(v)])),
        ]))
        : undefined;
    // Override React mappings AFTER all other processing to ensure single instance.
    // Remove any "react/" prefix match since we have explicit mappings.
    if (imports) {
        const reactMap = getReactImportMap();
        delete imports["react/"];
        imports = { ...imports, ...reactMap };
    }
    return { imports, scopes };
}
function mergeWithDefault(importMap) {
    return mergeImportMaps(getDefaultImportMap(), {
        imports: importMap.imports ?? {},
        scopes: importMap.scopes ?? {},
    });
}
export function loadImportMap(startPath, adapter) {
    return withSpan("modules.importMap.load", async () => {
        const runtimeAdapter = adapter ??
            (await (async () => {
                const { runtime } = await import("../../platform/adapters/detect.js");
                return runtime.get();
            })());
        try {
            const cfg = await getConfig(startPath, runtimeAdapter);
            const importMap = cfg?.resolve?.importMap;
            if (importMap && typeof importMap === "object") {
                return normalizeImportMapForRuntime(mergeWithDefault(importMap));
            }
        }
        catch {
            // Config not found or invalid, fall through to file-based discovery
        }
        let currentPath = startPath;
        while (currentPath !== "/" && currentPath !== "") {
            const denoJsonPath = join(currentPath, "deno.json");
            try {
                const content = await runtimeAdapter.fs.readFile(denoJsonPath);
                const config = JSON.parse(content);
                if (config.imports || config.scopes) {
                    logger.debug(`Loaded import map from ${denoJsonPath}`);
                    return normalizeImportMapForRuntime(mergeWithDefault(config));
                }
            }
            catch {
                // deno.json not found in this directory, continue searching
            }
            const parent = dirname(currentPath);
            if (parent === currentPath)
                break;
            currentPath = parent;
        }
        return normalizeImportMapForRuntime(getDefaultImportMap());
    }, { "importMap.startPath": startPath });
}
