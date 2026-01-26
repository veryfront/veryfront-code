import { HASH_SEED_DJB2 } from "../../../utils/index.js";
function computeHash(content) {
    let hash = HASH_SEED_DJB2;
    if (typeof content === "string") {
        for (let i = 0; i < content.length; i++) {
            hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
        }
        return hash >>> 0;
    }
    for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content[i];
    }
    return hash >>> 0;
}
export function computeEtag(content, weak = true) {
    const hash = computeHash(content).toString(16);
    return weak ? `W/"${hash}"` : `"${hash}"`;
}
export function computeStrongEtag(content) {
    return computeEtag(content, false);
}
export function hasMatchingEtag(req, etag) {
    return req.headers.get("if-none-match") === etag;
}
export function parseIfNoneMatch(header) {
    if (!header)
        return [];
    return header
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}
export function matchesAnyEtag(etag, ifNoneMatch) {
    const tags = parseIfNoneMatch(ifNoneMatch);
    return tags.includes("*") || tags.includes(etag);
}
