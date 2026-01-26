/** Sanitize data to prevent XSS and prototype pollution attacks */
export function sanitizeData(data) {
    if (typeof data === "string")
        return sanitizeString(data);
    if (Array.isArray(data))
        return data.map(sanitizeData);
    if (!data || typeof data !== "object")
        return data;
    return sanitizeObject(data);
}
function sanitizeString(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/\//g, "&#x2F;");
}
function sanitizeObject(obj) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        const safeKey = sanitizeKey(key);
        if (!isAllowedKey(safeKey))
            continue;
        sanitized[safeKey] = sanitizeData(value);
    }
    return sanitized;
}
function sanitizeKey(key) {
    return key.replace(/[^\w.-]/g, "");
}
function isAllowedKey(key) {
    const lower = key.toLowerCase();
    return (!lower.includes("__proto__") &&
        !lower.includes("constructor") &&
        !lower.includes("prototype"));
}
