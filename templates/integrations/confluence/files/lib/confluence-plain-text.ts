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
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}
