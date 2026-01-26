/**
 * File Resolution Candidate Utilities
 *
 * Utilities for building and finding file candidates with extension fallbacks.
 *
 * @module rendering/orchestrator/file-resolver/candidates
 */
/** Build candidate paths for a base path with extensions (direct and index variants) */
export declare function buildCandidatePaths(baseDir: string, fileName: string, extensions: string[]): string[];
/** Find the first existing path from candidates using the provided stat function */
export declare function findFirstExisting(candidates: string[], statFn: (path: string) => Promise<unknown>): Promise<string | null>;
//# sourceMappingURL=candidates.d.ts.map