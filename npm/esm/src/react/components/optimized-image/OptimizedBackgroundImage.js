import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "../../../utils/constants/network.js";
import { getOptimizedPath } from "./helpers.js";
export function OptimizedBackgroundImage({ src, children, format = "webp", quality = 80, size = RESPONSIVE_IMAGE_WIDTH_LG, className, style, }) {
    const optimizedSrc = getOptimizedPath(src, format, size, quality);
    return (React.createElement("div", { className: className, style: {
            backgroundImage: `url(${optimizedSrc})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            ...style,
        } }, children));
}
