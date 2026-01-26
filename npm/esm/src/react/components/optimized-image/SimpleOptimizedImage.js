import { RESPONSIVE_IMAGE_WIDTH_LG, RESPONSIVE_IMAGE_WIDTHS } from "../../../utils/index.js";
import { generateSrcSet, getOptimizedPath } from "./helpers.js";
const DEFAULT_SIZES = [...RESPONSIVE_IMAGE_WIDTHS];
export function SimpleOptimizedImage({ src, alt, width, height, format = "webp", quality = 80, loading = "lazy", className, style, onClick, onLoad, onError, }) {
    const srcSet = generateSrcSet(src, format, DEFAULT_SIZES, quality);
    return (React.createElement("img", { src: getOptimizedPath(src, format, width ?? RESPONSIVE_IMAGE_WIDTH_LG, quality), srcSet: srcSet, alt: alt, width: width, height: height, loading: loading, decoding: "async", className: className, style: style, onClick: onClick, onLoad: onLoad, onError: onError }));
}
