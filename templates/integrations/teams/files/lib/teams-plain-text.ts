export function htmlToPlainText(html: string): string {
  // Strip tags to a fixed point so overlapping fragments cannot survive a
  // single pass. Decode &amp; last so nested entities unescape exactly once.
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text
      .replace(
        /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, "");
  } while (text !== previous);

  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
