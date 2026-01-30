import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG, RESPONSIVE_IMAGE_WIDTHS } from "../../../utils/index.js";
import { generateSrcSet, getImageExtension, getOptimizedPath } from "./helpers.js";
const DEFAULT_SIZES = RESPONSIVE_IMAGE_WIDTHS;
const DEFAULT_FORMATS = ["avif", "webp", "jpeg"];
export function OptimizedImage({ src, alt, width, height, sizes = "100vw", formats = DEFAULT_FORMATS, quality = 80, loading, priority = false, className, style, placeholder = "empty", blurDataURL, onClick, onLoad, onError, }) {
    const loadingStrategy = priority ? "eager" : (loading ?? "lazy");
    const originalFormat = getImageExtension(src);
    const imgStyle = {
        ...style,
        ...(placeholder === "blur" && blurDataURL
            ? { backgroundImage: `url(${blurDataURL})`, backgroundSize: "cover" }
            : undefined),
    };
    return (React.createElement("picture", null,
        formats.map((format) => (React.createElement("source", { key: format, type: `image/${format}`, srcSet: generateSrcSet(src, format, [...DEFAULT_SIZES], quality), sizes: sizes }))),
        React.createElement("img", { src: getOptimizedPath(src, originalFormat, width ?? RESPONSIVE_IMAGE_WIDTH_LG, quality), alt: alt, width: width, height: height, loading: loadingStrategy, decoding: "async", className: className, style: imgStyle, onClick: onClick, onLoad: onLoad, onError: onError })));
}
