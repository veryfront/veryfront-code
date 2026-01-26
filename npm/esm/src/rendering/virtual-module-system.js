import * as dntShim from "../../_dnt.shims.js";
import { initialize, transform } from "esbuild";
import { createError, toError } from "../errors/veryfront-error.js";
import { loadImportMap, transformImportsWithMap } from "../modules/import-map/index.js";
export class VirtualModuleSystem {
    modules = new Map();
    baseUrl;
    adapter;
    constructor(baseUrl = "/_veryfront/modules", adapter) {
        this.baseUrl = baseUrl;
        if (!adapter) {
            throw toError(createError({
                type: "render",
                message: "VirtualModuleSystem requires a RuntimeAdapter to be provided",
            }));
        }
        this.adapter = adapter;
    }
    register(id, source, projectDir) {
        return this.registerModule(id, source, projectDir);
    }
    async registerModule(id, source, projectDir) {
        const importMap = await loadImportMap(projectDir, this.adapter);
        const hasTypeScript = source.includes("interface ") ||
            source.includes("type ") ||
            source.includes(": React.FC") ||
            (source.includes("<") && source.includes(">")) ||
            source.includes("Props>") ||
            source.includes("useState<") ||
            source.includes("useRef<");
        try {
            await initialize({ worker: false });
        }
        catch {
            // Already initialized
        }
        const result = await transform(source, {
            loader: hasTypeScript ? "tsx" : "jsx",
            jsx: "automatic",
            jsxImportSource: "react",
            format: "esm",
            target: "es2020",
        });
        let transformedCode = transformImportsWithMap(result.code, importMap, undefined, {
            resolveBare: true,
        });
        transformedCode = transformedCode
            .replace(/from\s+"https?:\/\/[^"']+react@[^"']+\/jsx-runtime"/g, 'from "react/jsx-runtime"')
            .replace(/from\s+"https?:\/\/[^"']+react@[^"']+\/jsx-dev-runtime"/g, 'from "react/jsx-dev-runtime"')
            .replace(/from\s+["']\.\/(\w+)\.tsx["']/g, 'from "/_veryfront/modules/component:$1"')
            .replace(/from\s+["']\.\/(\w+)\.jsx["']/g, 'from "/_veryfront/modules/component:$1"')
            .replace(/from\s+["']\.\/(\w+)["']/g, 'from "/_veryfront/modules/component:$1"')
            .replace(/import\(["']\.\/(\w+)\.tsx["']\)/g, 'import("/_veryfront/modules/component:$1")')
            .replace(/import\(["']\.\/(\w+)\.jsx["']\)/g, 'import("/_veryfront/modules/component:$1")')
            .replace(/import\(["']\.\/(\w+)["']\)/g, 'import("/_veryfront/modules/component:$1")');
        this.modules.set(id, {
            id,
            source,
            transformed: transformedCode,
            contentType: "application/javascript",
        });
        return `${this.baseUrl}/${encodeURIComponent(id)}`;
    }
    getModule(id) {
        return this.modules.get(id);
    }
    handleRequest(request) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith(this.baseUrl))
            return null;
        const moduleId = decodeURIComponent(url.pathname.slice(this.baseUrl.length + 1));
        const module = this.modules.get(moduleId);
        if (!module) {
            return new dntShim.Response("Module not found", { status: 404 });
        }
        return new dntShim.Response(module.transformed ?? module.source, {
            headers: {
                "Content-Type": module.contentType,
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
            },
        });
    }
    clear() {
        this.modules.clear();
    }
}
