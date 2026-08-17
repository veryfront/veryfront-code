export function htmlToPlainText(html: string): string {
  // Strip tags to a fixed point so overlapping fragments cannot survive a
  // single pass. Decode &amp; last so nested entities unescape exactly once.
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, " ");
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
