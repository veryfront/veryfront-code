export function isFullHTMLDocument(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  // A proper full HTML document must:
  // 1. Start with <!doctype (not just contain <html> tags somewhere)
  // 2. Have <html> and </html> tags
  // This prevents false positives from content that accidentally includes empty <html></html> tags
  return trimmed.startsWith("<!doctype") &&
    trimmed.includes("<html") &&
    trimmed.includes("</html>");
}
