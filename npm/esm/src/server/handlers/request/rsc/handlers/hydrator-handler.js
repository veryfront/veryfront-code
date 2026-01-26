import * as dntShim from "../../../../../../_dnt.shims.js";
import { createError, toError } from "../../../../../errors/veryfront-error.js";
import { createFileSystem } from "../../../../../platform/compat/fs.js";
import * as pathHelper from "../../../../../platform/compat/path-helper.js";
import { serverLogger as logger } from "../../../../../utils/index.js";
const compatFs = createFileSystem();
export class HydratorHandler {
    fsAdapter;
    constructor(fsAdapter) {
        this.fsAdapter = fsAdapter;
    }
    async handle() {
        const hydratorPath = pathHelper.join(pathHelper.dirname(pathHelper.fromFileUrl(globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url)), "../../../../../rendering/rsc/hydrate-client.ts");
        try {
            const bundled = await this.bundleHydrator(hydratorPath);
            return this.createJavaScriptResponse(bundled);
        }
        catch (error) {
            logger.error("[RSC] Hydrator bundling failed:", error);
            return this.fallbackToSource(hydratorPath);
        }
    }
    readHydratorFile(path) {
        return this.fsAdapter ? this.fsAdapter.readFile(path) : compatFs.readTextFile(path);
    }
    async bundleHydrator(path) {
        const { build, stop } = await import("esbuild");
        try {
            const source = await this.readHydratorFile(path);
            const result = await build({
                bundle: true,
                write: false,
                format: "esm",
                platform: "browser",
                target: "es2020",
                stdin: {
                    contents: source,
                    loader: "ts",
                    resolveDir: pathHelper.dirname(path),
                    sourcefile: path,
                },
                external: [
                    "react",
                    "react-dom",
                    "react-dom/client",
                    "node:os",
                    "node:fs",
                    "node:fs/promises",
                    "node:process",
                ],
                logLevel: "warning",
            });
            const outputText = result.outputFiles?.[0]?.text;
            if (!outputText) {
                throw toError(createError({
                    type: "config",
                    message: "esbuild produced no output",
                }));
            }
            logger.debug("[RSC] Hydrator bundled successfully", { size: outputText.length });
            return outputText;
        }
        finally {
            if (!dntShim.dntGlobalThis.__vfTestPreserveEsbuild) {
                await stop();
            }
        }
    }
    async fallbackToSource(path) {
        try {
            const source = await this.readHydratorFile(path);
            return this.createJavaScriptResponse(source);
        }
        catch (readError) {
            logger.error("[RSC] Failed to read hydrator file:", readError);
            return this.createFallbackResponse();
        }
    }
    createJavaScriptResponse(content) {
        return new dntShim.Response(content, {
            headers: {
                "content-type": "application/javascript",
                "cache-control": "no-cache",
            },
        });
    }
    createFallbackResponse() {
        const fallback = `export async function hydrateRSC(){ console.log('[RSC] Hydrator not available'); }`;
        return this.createJavaScriptResponse(fallback);
    }
}
