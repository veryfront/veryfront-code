import type { ComponentAnalysis } from "./types.js";
import type { FileSystemAdapter } from "../../platform/adapters/base.js";
export declare function analyzeComponent(filePath: string, fs: FileSystemAdapter): Promise<ComponentAnalysis>;
export declare function buildClientManifest(projectDir: string, appDir?: string, fs?: FileSystemAdapter): Promise<Map<string, import("./types.js").ClientComponentMeta>>;
//# sourceMappingURL=component-analyzer.d.ts.map