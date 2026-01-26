const CATCH_ALL_PATTERN = /\[\[?\.\.\.(\w+)\]\]?/g;
function extractCatchAllParams(pattern) {
    const params = new Set();
    if (!pattern)
        return params;
    for (const match of pattern.matchAll(CATCH_ALL_PATTERN)) {
        const name = match[1];
        if (name)
            params.add(name);
    }
    return params;
}
function decodeCatchAllValue(value) {
    if (!value)
        return [];
    return value
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment));
}
export function matchRoute(pathname, route) {
    const match = pathname.match(route.regex);
    if (!match)
        return null;
    const catchAllParams = extractCatchAllParams(route.pattern);
    const params = {};
    for (const [index, name] of (route.paramNames ?? []).entries()) {
        const value = match[index + 1] ?? "";
        params[name] = catchAllParams.has(name)
            ? decodeCatchAllValue(value)
            : decodeURIComponent(value);
    }
    return { params, route };
}
