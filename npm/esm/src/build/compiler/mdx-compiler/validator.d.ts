import type { CompileOptions } from "./types.js";
export declare function validateCompileParams(filePath: string, content: string, options: CompileOptions): void;
export declare function validateFileExists(filePath: string, content: string): Promise<void>;
export declare function pathExists(path: string): Promise<boolean>;
//# sourceMappingURL=validator.d.ts.map