import React from "react";
type Props = {
    src: string;
    children?: React.ReactNode;
    format?: "webp" | "avif" | "jpeg" | "png";
    quality?: number;
    size?: number;
    className?: string;
    style?: React.CSSProperties;
};
export declare function OptimizedBackgroundImage({ src, children, format, quality, size, className, style, }: Props): React.JSX.Element;
export {};
//# sourceMappingURL=OptimizedBackgroundImage.d.ts.map