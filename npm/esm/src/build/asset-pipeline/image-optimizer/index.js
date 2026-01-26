export { ImageOptimizer } from "./optimizer-core.js";
export { loadManifest as loadImageManifest } from "./manifest-manager.js";
import { ImageOptimizer } from "./optimizer-core.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
export function optimizeImages(options = {}) {
    return withSpan("build.asset.optimizeImages", () => new ImageOptimizer(options).optimize(), {
        "image.inputDir": options.inputDir ?? "default",
        "image.formats": options.formats?.join(",") ?? "default",
    });
}
