/**
 * CLI App Actions
 *
 * Handlers for opening projects in browser, Studio, and IDE.
 * Uses cross-runtime platform abstractions for filesystem and command execution.
 */
import type { ProjectInfo } from "./state.js";
import { type RuntimeEnv } from "../../config/runtime-env.js";
export type IDE = "cursor" | "code" | "zed" | "idea" | "webstorm";
export interface ActionResult {
    success: boolean;
    message?: string;
}
export declare function openInBrowser(project: ProjectInfo, port: number): Promise<ActionResult>;
export declare function openInStudio(project: ProjectInfo): Promise<ActionResult>;
export declare function detectIDEs(): Promise<IDE[]>;
export declare function getPreferredIDE(): Promise<IDE | null>;
export declare function openInIDE(project: ProjectInfo, ide?: IDE): Promise<ActionResult>;
export declare function openFileInIDE(filePath: string, ide?: IDE): Promise<ActionResult>;
export declare function clearProjectCache(project: ProjectInfo): Promise<ActionResult>;
export declare function openMCPSettings(env?: RuntimeEnv): Promise<ActionResult>;
export declare function quickOpen(projects: Array<{
    slug: string;
    path: string;
}>, num: number, port: number): Promise<ActionResult>;
//# sourceMappingURL=actions.d.ts.map