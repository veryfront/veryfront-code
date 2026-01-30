/**
 * JSX/TypeScript transform using native esbuild.
 * @see ./esbuild.ts for deno compile VFS extraction
 */
import { getEsbuild, initializeEsbuild } from "./esbuild.js";
let esbuildInitialized = false;
export async function transformJsx(source, options = {}) {
    const loader = options.loader ?? "tsx";
    const esbuild = await getEsbuild();
    const result = await esbuild.transform(source, {
        loader,
        jsx: "automatic",
        jsxImportSource: "react",
        format: "esm",
        target: "es2020",
    });
    return { code: result.code };
}
/** Call at server startup to ensure esbuild binary is available. */
export async function initializeTransform() {
    if (esbuildInitialized)
        return;
    await initializeEsbuild();
    esbuildInitialized = true;
}
export function isUsingEsbuild() {
    return true;
}
