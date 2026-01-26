import { ensureError } from "../../../errors/veryfront-error.js";
import { withSpanSync } from "../../../observability/tracing/otlp-setup.js";
import { bundlerLogger as logger } from "../../../utils/index.js";
export function bundleCss(source, options, result) {
    withSpanSync("build.renderer.bundleCSS", () => {
        try {
            const processedCss = options.mode === "production"
                ? minifyCss(source.content)
                : source.content;
            result.outputs.set(source.path, {
                path: source.path,
                content: processedCss,
                type: "css",
            });
            logger.debug(`Bundled CSS: ${source.path}`);
        }
        catch (error) {
            logger.error(`Failed to bundle CSS ${source.path}`, error);
            result.errors.push(ensureError(error));
        }
    }, {
        "source.path": source.path,
        "options.mode": options.mode,
    });
}
function minifyCss(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*([{}:;,])\s*/g, "$1")
        .replace(/;}/g, "}")
        .replace(/url\(["']([^"']+)["']\)/g, "url($1)")
        .trim();
}
export function processCssImports(css, _fromPath) {
    return css;
}
export function extractCssVariables(css) {
    const variables = {};
    const varRegex = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
    let match;
    while ((match = varRegex.exec(css)) !== null) {
        const key = match[1];
        const val = match[2];
        if (key && val)
            variables[key] = val.trim();
    }
    return variables;
}
