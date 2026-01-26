export function parseStackTrace(stack) {
    if (!stack)
        return [];
    return stack
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((raw) => ({ raw }));
}
export function formatStackTrace(stack) {
    return stack || "";
}
export function hasStackTrace(error) {
    return Boolean(error.stack);
}
