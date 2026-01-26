export function isFullHTMLDocument(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype") &&
    trimmed.includes("<html") &&
    trimmed.includes("</html>")
  );
}
