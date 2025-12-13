/**
 * Checks if content is a complete HTML document with proper structure.
 * Uses stricter pattern matching to avoid false positives from strings
 * containing HTML-like content (e.g., JavaScript containing "<html").
 */
export function isFullHTMLDocument(content: string): boolean {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  // Check for DOCTYPE or opening html tag at the start (with optional whitespace/BOM)
  const hasDoctype = /^(\ufeff)?<!doctype\s+html/i.test(trimmed);
  const startsWithHtml = /^(\ufeff)?<html[\s>]/i.test(trimmed);

  // Must have both opening and closing html tags
  const hasOpeningHtml = /<html[\s>]/i.test(lower);
  const hasClosingHtml = lower.includes("</html>");

  return (hasDoctype || startsWithHtml) && hasOpeningHtml && hasClosingHtml;
}
