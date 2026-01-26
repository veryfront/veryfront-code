import { buildDirCacheKeyPrefix as buildDirCacheKeyPrefixCore, buildFileCacheKeyPrefix as buildFileCacheKeyPrefixCore, buildFileListCacheKey as buildFileListCacheKeyCore, buildStatCacheKeyPrefix as buildStatCacheKeyPrefixCore, } from "../../../../cache/index.js";
function toFileOperationContext(ctx) {
    if (!ctx)
        return ctx;
    const { sourceType, projectSlug, branch, releaseId, environmentName } = ctx;
    return { sourceType, projectSlug, branch, releaseId, environmentName };
}
export function buildFileCacheKeyPrefix(ctx) {
    return buildFileCacheKeyPrefixCore(toFileOperationContext(ctx));
}
export function buildStatCacheKeyPrefix(ctx) {
    return buildStatCacheKeyPrefixCore(toFileOperationContext(ctx));
}
export function buildDirCacheKeyPrefix(ctx) {
    return buildDirCacheKeyPrefixCore(toFileOperationContext(ctx));
}
export function buildFileListCacheKey(ctx) {
    return buildFileListCacheKeyCore(toFileOperationContext(ctx));
}
