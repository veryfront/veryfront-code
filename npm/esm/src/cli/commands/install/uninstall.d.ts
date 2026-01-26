/**
 * Uninstall Command - Remove AI assistant integrations
 */
import { type RuntimeEnv } from "../../../config/runtime-env.js";
import { type AIToolId, type UninstallOptions } from "./types.js";
export declare function parseTargetFlag(target: string): AIToolId[];
export declare function findInstalledTools(options: Pick<UninstallOptions, "cwd" | "global">, env?: RuntimeEnv): Promise<AIToolId[]>;
export declare function uninstallTargets(targets: AIToolId[], options: Pick<UninstallOptions, "cwd" | "global">, env?: RuntimeEnv): Promise<void>;
export declare function uninstallCommand(options?: UninstallOptions): Promise<void>;
//# sourceMappingURL=uninstall.d.ts.map