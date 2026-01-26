/**
 * JavaScript/TypeScript bundling service
 */
import { bundlerLogger as logger } from "../../../utils/index.js";
import { extractImports } from "../utils/import-utils.js";
import { getEsbuildLoader } from "../../utils/file-types.js";
import { createError, ensureError, toError } from "../../../errors/veryfront-error.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
/**
 * Bundle JavaScript/TypeScript files
 */
export function bundleScript(source, options, result, esbuildInstance, fileCache) {
    return withSpan("build.renderer.bundleScript", async () => {
        const isProduction = options.mode === "production";
        try {
            fileCache.set(source.path, source.content);
            const buildResult = await esbuildInstance.build({
                stdin: {
                    contents: source.content,
                    sourcefile: source.path,
                    resolveDir: options.projectDir,
                    loader: getEsbuildLoader(source.path),
                },
                bundle: true,
                format: options.platform === "node" ? "cjs" : "esm",
                platform: options.platform ?? "browser",
                target: isProduction ? ["es2020"] : ["esnext"],
                minify: isProduction,
                sourcemap: isProduction ? false : "inline",
                treeShaking: isProduction,
                external: options.external ?? [],
                write: false,
                plugins: [
                    createResolvePlugin(fileCache, options.projectDir),
                    createDynamicImportPlugin(),
                    createCSSPlugin(result),
                ],
                define: {
                    "process.env.NODE_ENV": JSON.stringify(options.mode),
                },
                logLevel: "silent",
            });
            const output = buildResult.outputFiles?.[0];
            if (output) {
                const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");
                if (!output.text) {
                    throw toError(createError({
                        type: "build",
                        message: `Build output missing for ${source.path}`,
                    }));
                }
                result.outputs.set(outputPath, {
                    path: outputPath,
                    content: output.text,
                    type: "js",
                });
                result.dependencies.set(source.path, extractImports(source.content));
                logger.debug(`Bundled script: ${source.path} -> ${outputPath}`);
            }
            for (const warning of buildResult.warnings) {
                result.warnings.push(formatEsbuildMessage(warning));
            }
        }
        catch (error) {
            logger.error(`Failed to bundle script ${source.path}`, error);
            if (error instanceof Error && "errors" in error) {
                for (const err of error.errors) {
                    result.errors.push(new Error(formatEsbuildMessage(err)));
                }
                return;
            }
            result.errors.push(ensureError(error));
        }
    }, {
        "source.path": source.path,
        "source.type": source.type,
        "options.mode": options.mode,
        "options.platform": options.platform ?? "browser",
    });
}
function createResolvePlugin(fileCache, projectDir) {
    return {
        name: "veryfront-resolve",
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                if (!fileCache.has(args.path))
                    return undefined;
                return { path: args.path, namespace: "veryfront-cache" };
            });
            build.onLoad({ filter: /.*/, namespace: "veryfront-cache" }, (args) => {
                const content = fileCache.get(args.path);
                if (!content)
                    return undefined;
                return {
                    contents: content,
                    loader: getEsbuildLoader(args.path),
                    resolveDir: projectDir,
                };
            });
        },
    };
}
function createCSSPlugin(result) {
    const fs = createFileSystem();
    return {
        name: "veryfront-css",
        setup(build) {
            build.onLoad({ filter: /\.css$/ }, async (args) => {
                try {
                    const content = await fs.readTextFile(args.path);
                    result.outputs.set(args.path, {
                        path: args.path,
                        content,
                        type: "css",
                    });
                    return {
                        contents: `export default ${JSON.stringify(content)}`,
                        loader: "js",
                    };
                }
                catch (error) {
                    return {
                        errors: [
                            {
                                text: `Failed to load CSS: ${error}`,
                                location: null,
                            },
                        ],
                    };
                }
            });
        },
    };
}
function createDynamicImportPlugin() {
    return {
        name: "veryfront-dynamic-import",
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                if (args.kind !== "dynamic-import")
                    return undefined;
                const isBare = !args.path.startsWith(".") &&
                    !args.path.startsWith("/") &&
                    !args.path.startsWith("http://") &&
                    !args.path.startsWith("https://");
                if (!isBare)
                    return undefined;
                return { path: args.path, external: true };
            });
        },
    };
}
function formatEsbuildMessage(msg) {
    if (!msg.location)
        return msg.text;
    return `${msg.location.file}:${msg.location.line}:${msg.location.column}: ${msg.text}`;
}
