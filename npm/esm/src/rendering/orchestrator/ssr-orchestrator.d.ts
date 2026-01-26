import type * as React from "react";
import type { ElementValidator } from "../element-validator/index.js";
import type { SSRRenderer } from "../ssr-renderer.js";
import type { HTMLGenerationContext, HTMLGenerator } from "./html.js";
import type { RenderOptions } from "./types.js";
export interface SSROrchestratorConfig {
    mode: "development" | "production";
    debugMode: boolean;
    elementValidator: ElementValidator;
    ssrRenderer: SSRRenderer;
    htmlGenerator: HTMLGenerator;
}
export interface SSRRenderingResult {
    fullHtml: string;
    finalStream: ReadableStream | null;
    ssrHash: string;
}
export declare class SSROrchestrator {
    private config;
    constructor(config: SSROrchestratorConfig);
    performSSRRendering(pageElement: React.ReactElement, generationContext: Omit<HTMLGenerationContext, "html" | "ssrHash">, options?: RenderOptions): Promise<SSRRenderingResult>;
    private createStream;
}
//# sourceMappingURL=ssr-orchestrator.d.ts.map