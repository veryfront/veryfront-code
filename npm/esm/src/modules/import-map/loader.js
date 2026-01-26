import { rendererLogger as logger } from "../../utils/index.js";
import { dirname, join } from "../../platform/compat/path/index.js";
import { getConfig } from "../../config/index.js";
import { getDefaultImportMap, getDenoReactImportMap } from "./default-import-map.js";
import { mergeImportMaps } from "./merger.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { isDeno } from "../../platform/compat/runtime.js";
function normalizeImportMapForRuntime(importMap) {
    const normalizeValue = (value) => {
        if (!value.startsWith("npm:"))
            return value;
        const spec = value.slice(4);
        const [base, query] = spec.split("?");
        const url = `https://esm.sh/${base}`;
        return query ? `${url}?${query}` : `${url}?target=es2022`;
    };
    let imports = importMap.imports
        ? Object.fromEntries(Object.entries(importMap.imports).map(([k, v]) => [k, normalizeValue(v)]))
        : undefined;
    let scopes = importMap.scopes
        ? Object.fromEntries(Object.entries(importMap.scopes).map(([scope, mappings]) => [
            scope,
            Object.fromEntries(Object.entries(mappings).map(([k, v]) => [k, normalizeValue(v)])),
        ]))
        : undefined;
    // CRITICAL: For Deno SSR, always use shared-*.ts files for React.
    // Project configs may have esm.sh URLs which would create multiple React instances.
    // Override React mappings AFTER all other processing to ensure single instance.
    // Also remove any "react/" prefix match since we have explicit mappings.
    if (isDeno && imports) {
        const reactMap = getDenoReactImportMap();
        // Remove any esm.sh "react/" prefix mapping that would break subpath resolution
        delete imports["react/"];
        imports = { ...imports, ...reactMap };
    }
    // For Deno SSR, ensure esm.sh scope has React mappings to shared-*.ts files.
    // This is critical because esm.sh modules with external=react have bare `react`
    // imports that need to resolve to our shared React instance.
    if (isDeno) {
        const reactMap = getDenoReactImportMap();
        const esmShScope = scopes?.["https://esm.sh/"] ?? {};
        // Remove any "react/" prefix match from scope as well
        delete esmShScope["react/"];
        scopes = {
            ...scopes,
            "https://esm.sh/": { ...esmShScope, ...reactMap },
        };
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
