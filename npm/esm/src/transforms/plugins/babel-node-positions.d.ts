/**
 * Babel Transform for TSX Source Position Injection
 *
 * Injects data-node-* attributes into JSX elements for Studio Navigator integration.
 * This mirrors the position tracking done by remarkAddNodeId for MDX files.
 */
interface TransformOptions {
    filePath: string;
}
/**
 * Transform TSX source to inject position data attributes into JSX elements.
 * This enables Studio Navigator to map rendered elements back to source positions.
 */
export declare function injectNodePositions(source: string, _options: TransformOptions): string;
export {};
//# sourceMappingURL=babel-node-positions.d.ts.map