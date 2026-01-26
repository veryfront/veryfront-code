/** Generate a unique ID with optional prefix (e.g., "msg-a1B2c3D4e5F6g7H8") */
export declare function generateId(prefix?: string): string;
/** Create an ID generator with fixed prefix and optional configuration */
export declare function createIdGenerator(options: {
    prefix?: string;
    separator?: string;
    size?: number;
}): () => string;
//# sourceMappingURL=id.d.ts.map