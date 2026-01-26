/**
 * Open Veryfront Studio in browser
 * @module cli/commands/studio
 */
import { type RuntimeEnv } from "../../config/runtime-env.js";
/**
 * Build Studio URL with optional query params
 */
export declare function buildStudioUrl(project: string, options?: {
    branch?: string;
    file?: string;
}): string;
/**
 * Open Veryfront Studio in browser
 */
export declare function studioCommand(options?: {
    project?: string;
    branch?: string;
    file?: string;
}, env?: RuntimeEnv): Promise<{
    url: string;
    opened: boolean;
}>;
//# sourceMappingURL=studio.d.ts.map