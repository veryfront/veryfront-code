import type React from "react";
import type { OptimizedImageProps } from "./OptimizedImage.js";
export declare function SimpleOptimizedImage({ src, alt, width, height, format, quality, loading, className, style, onClick, onLoad, onError, }: Omit<OptimizedImageProps, "formats" | "sizes" | "priority" | "placeholder" | "blurDataURL"> & {
    format?: "webp" | "avif" | "jpeg" | "png";
}): React.JSX.Element;
//# sourceMappingURL=SimpleOptimizedImage.d.ts.map