import type { ComponentProps, RenderMetadata } from "../types/index.js";
import type { HTMLGenerationOptions } from "./types.js";
export declare function generateHTMLShellParts(meta: RenderMetadata, options: HTMLGenerationOptions, params?: Record<string, string | string[]>, props?: ComponentProps, contentForTailwind?: string): Promise<{
    start: string;
    end: string;
}>;
export declare function wrapInHTMLShell(content: string, meta: RenderMetadata, options: HTMLGenerationOptions, params?: Record<string, string | string[]>, props?: ComponentProps): Promise<string>;
//# sourceMappingURL=html-shell-generator.d.ts.map