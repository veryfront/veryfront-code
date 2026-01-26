import React from "react";
export interface OptimizedImageProps {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    sizes?: string;
    formats?: ("avif" | "webp" | "jpeg" | "png")[];
    quality?: number;
    loading?: "lazy" | "eager";
    priority?: boolean;
    className?: string;
    style?: React.CSSProperties;
    placeholder?: "blur" | "empty";
    blurDataURL?: string;
    onClick?: (event: React.MouseEvent<HTMLImageElement>) => void;
    onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
    onError?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
}
export declare function OptimizedImage({ src, alt, width, height, sizes, formats, quality, loading, priority, className, style, placeholder, blurDataURL, onClick, onLoad, onError, }: OptimizedImageProps): React.JSX.Element;
//# sourceMappingURL=OptimizedImage.d.ts.map