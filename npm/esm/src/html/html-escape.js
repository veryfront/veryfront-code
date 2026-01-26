export function escapeHTML(str) {
    if (str == null)
        return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
export const escapeHtml = escapeHTML;
export function buildAttributes(attrs) {
    return Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeHTML(String(value))}"`)
        .join(" ");
}
