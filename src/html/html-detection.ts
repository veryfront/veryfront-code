export function isFullHTMLDocument(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return trimmed.includes("<html") && trimmed.includes("</html>");
}
