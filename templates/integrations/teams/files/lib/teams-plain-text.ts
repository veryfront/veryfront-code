const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

export function htmlToPlainText(html: string): string {
  let text = "";
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    const close = open === -1 ? -1 : html.indexOf(">", open + 1);
    if (close === -1) {
      text += html.slice(cursor);
      break;
    }
    text += html.slice(cursor, open);
    const tag = html.slice(open, close + 1);
    const tagName = /^<\/?(\w+)\b/.exec(tag)?.[1]?.toLowerCase();
    if (BLOCK_TAGS.has(tagName ?? "")) {
      text += " ";
    }
    cursor = close + 1;
  }

  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}
