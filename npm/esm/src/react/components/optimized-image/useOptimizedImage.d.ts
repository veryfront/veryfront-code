export declare function useOptimizedImage(src: string, options?: {
    formats?: Array<"avif" | "webp" | "jpeg" | "png">;
    quality?: number;
}): {
    sources: Array<{
        format: "avif" | "webp" | "jpeg" | "png";
        srcSet: string;
        type: string;
    }>;
    fallback: string;
};
//# sourceMappingURL=useOptimizedImage.d.ts.map