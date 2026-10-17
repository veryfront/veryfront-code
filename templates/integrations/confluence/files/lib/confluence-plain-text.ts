const capturedTextReplace = String.prototype.replace;
const applyTextReplace = Reflect.apply;

const namedEntityText: Record<string, string> = {
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

function decodeNamedEntities(value: string): string {
  return applyTextReplace(capturedTextReplace, value, [
    /&(?:nbsp|lt|gt|quot|#39|amp);/g,
    (entity: string): string => namedEntityText[entity]!,
  ]) as string;
}

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

  return decodeNamedEntities(text)
    .replace(/\s+/g, " ")
    .trim();
}
