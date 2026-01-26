export function isDynamicRoute(pattern) {
    return /\[[\w.]+\]/.test(pattern);
}
function isSpreadParam(part) {
    return part.startsWith("[...") && part.endsWith("]");
}
function isDynamicParam(part) {
    return part.startsWith("[") && part.endsWith("]");
}
function hasSpreadParam(parts) {
    return parts.some(isSpreadParam);
}
export function extractParams(pattern, slug) {
    const patternParts = pattern.split("/").filter(Boolean);
    const slugParts = slug.split("/").filter(Boolean);
    const params = {};
    if (!hasSpreadParam(patternParts) && patternParts.length !== slugParts.length) {
        return null;
    }
    let slugIndex = 0;
    for (const patternPart of patternParts) {
        if (isSpreadParam(patternPart)) {
            const paramName = patternPart.slice(4, -1);
            params[paramName] = slugParts.slice(slugIndex);
            return params;
        }
        const slugPart = slugParts[slugIndex];
        if (isDynamicParam(patternPart)) {
            if (slugPart === undefined) {
                return null;
            }
            const paramName = patternPart.slice(1, -1);
            params[paramName] = slugPart;
            slugIndex++;
            continue;
        }
        if (slugPart !== patternPart) {
            return null;
        }
        slugIndex++;
    }
    if (slugIndex < slugParts.length) {
        return null;
    }
    return params;
}
export function matchesPattern(pattern, slug) {
    return extractParams(pattern, slug) !== null;
}
