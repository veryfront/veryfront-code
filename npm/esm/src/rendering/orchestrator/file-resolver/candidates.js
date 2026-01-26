/**
 * File Resolution Candidate Utilities
 *
 * Utilities for building and finding file candidates with extension fallbacks.
 *
 * @module rendering/orchestrator/file-resolver/candidates
 */
/** Build candidate paths for a base path with extensions (direct and index variants) */
export function buildCandidatePaths(baseDir, fileName, extensions) {
    const direct = extensions.map((ext) => `${baseDir}/${fileName}${ext}`);
    const index = extensions.map((ext) => `${baseDir}/${fileName}/index${ext}`);
    return [...direct, ...index];
}
/** Find the first existing path from candidates using the provided stat function */
export async function findFirstExisting(candidates, statFn) {
    for (const fullPath of candidates) {
        try {
            await statFn(fullPath);
            return fullPath;
        }
        catch {
            // ignore
        }
    }
    return null;
}
