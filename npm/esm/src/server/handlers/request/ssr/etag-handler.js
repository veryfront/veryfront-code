/**** ETag computation for SSR responses */
import { computeEtag } from "../../utils/etag.js";
function normalizeWeakEtag(hash) {
    const trimmed = hash.trim();
    if (!trimmed)
        return computeEtag("");
    const value = trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
    const unquoted = value.replace(/^"+|"+$/g, "").trim();
    return `W/"${unquoted}"`;
}
/** Compute ETag for SSR result (prefers ssrHash if available) */
export function computeSSRETag(ssrHash, html) {
    if (ssrHash)
        return normalizeWeakEtag(ssrHash);
    return computeEtag(html);
}
