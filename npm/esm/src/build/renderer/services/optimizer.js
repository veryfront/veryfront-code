/****
 * Bundle optimization service
 */
import { bundlerLogger as logger } from "../../../utils/index.js";
import * as esbuild from "esbuild";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
export function optimizeBundle(result, options) {
    if (options.mode !== "production")
        return;
    return withSpan("build.renderer.optimizeBundle", async () => {
        try {
            for (const [, output] of result.outputs) {
                if (output.type !== "js")
                    continue;
                const { code } = await esbuild.transform(output.content, {
                    minify: true,
                    target: "es2020",
                    loader: "js",
                });
                output.content = code;
            }
            logger.info("Bundle optimized", {
                files: result.outputs.size,
                mode: options.mode,
            });
        }
        catch (error) {
            logger.error("Bundle optimization failed", { error });
        }
    }, {
        "options.mode": options.mode,
        "outputs.count": result.outputs.size,
    });
}
