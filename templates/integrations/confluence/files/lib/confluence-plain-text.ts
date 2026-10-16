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
    text += " ";
    cursor = close + 1;
  }

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
