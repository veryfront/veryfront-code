/**
 * File Resolver
 *
 * Utilities for finding source files and local lib files.
 *
 * @module rendering/orchestrator/file-resolver
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
export { buildCandidatePaths, findFirstExisting } from "./candidates.js";
export declare function getLocalLibDir(): string;
export declare function findLocalLibFile(relativePath: string, localAdapter: RuntimeAdapter): Promise<string | null>;
export declare function findSourceFile(basePath: string, projectDir: string, adapter: RuntimeAdapter): Promise<string | null>;
//# sourceMappingURL=index.d.ts.map