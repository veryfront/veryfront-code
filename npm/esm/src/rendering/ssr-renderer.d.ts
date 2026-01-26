/**
 * SSR Renderer
 *
 * Handles server-side rendering of React elements using both streaming and string methods.
 * Provides React 18/19 streaming support with fallback to string rendering.
 */
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type * as React from "react";
export interface SSRRenderOptions {
    mode: string;
    wantsStream: boolean;
    debugMode?: boolean;
}
export interface SSRRenderResult {
    html: string;
    stream: ReadableStream | null;
}
export declare class SSRRenderer {
    private readonly mode;
    private readonly adapter?;
    private readonly projectDir?;
    private versionInfo;
    constructor(mode: string, adapter?: RuntimeAdapter, projectDir?: string);
    private getVersionInfo;
    renderToHTML(pageElement: React.ReactElement, options: SSRRenderOptions): Promise<SSRRenderResult>;
    getRenderingStrategy(): {
        method: "streaming" | "string";
        reactVersion: string;
        features: {
            streaming: boolean;
            suspense: boolean;
            concurrent: boolean;
        };
    };
    supportsStreaming(): boolean;
}
//# sourceMappingURL=ssr-renderer.d.ts.map