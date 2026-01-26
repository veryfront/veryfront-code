export function isFullHTMLDocument(content) {
    const trimmed = content.trim().toLowerCase();
    return (trimmed.startsWith("<!doctype") &&
        trimmed.includes("<html") &&
        trimmed.includes("</html>"));
}
