/**
 * Install Command - AI assistant integration installer
 */
import { type RuntimeEnv } from "../../../config/runtime-env.js";
import { type AIToolId, type InstallOptions } from "./types.js";
export declare function parseTargetFlag(target: string): AIToolId[];
export declare function installTargets(targets: AIToolId[], options: Pick<InstallOptions, "cwd" | "force" | "global">, env?: RuntimeEnv): Promise<void>;
export declare function installCommand(options?: InstallOptions): Promise<void>;
//# sourceMappingURL=install.d.ts.map