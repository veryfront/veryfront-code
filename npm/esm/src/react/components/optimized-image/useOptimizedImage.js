import { RESPONSIVE_IMAGE_WIDTH_LG, RESPONSIVE_IMAGE_WIDTHS } from "../../../utils/index.js";
import { generateSrcSet, getExtension, getOptimizedPath } from "./helpers.js";
const DEFAULT_SIZES = [...RESPONSIVE_IMAGE_WIDTHS];
const DEFAULT_FORMATS = ["avif", "webp", "jpeg"];
export function useOptimizedImage(src, options = {}) {
    const formats = options.formats ?? DEFAULT_FORMATS;
    const quality = options.quality ?? 80;
    const sources = formats.map((format) => ({
        format,
        srcSet: generateSrcSet(src, format, DEFAULT_SIZES, quality),
        type: `image/${format}`,
    }));
    const fallback = getOptimizedPath(src, getExtension(src), RESPONSIVE_IMAGE_WIDTH_LG, quality);
    return { sources, fallback };
}
