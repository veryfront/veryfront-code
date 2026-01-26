import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
export declare function rewriteEsmPaths(code: string, urlBase: string): string;
export declare function fetchEsmModule(url: string, tmpDir: string, localAdapter: RuntimeAdapter, esmCache: Map<string, string>): Promise<string>;
//# sourceMappingURL=esm-rewriter.d.ts.map