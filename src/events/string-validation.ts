/** Shared CloudEvents string and W3C tracestate validation at event read boundaries. */
export function isCloudEventsString(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) >= 0xfffe
    ) {
      return false;
    }
  }
  return true;
}

export function isTraceState(value: string): boolean {
  if (value.length > 512) return false;
  const members = value.split(",").filter((member) => !/^[ \t]*$/.test(member));
  if (members.length === 0 || members.length > 32) return false;
  const keys = new Set<string>();
  for (const member of members) {
    const separator = member.indexOf("=");
    if (separator < 0) return false;
    const key = member.slice(0, separator).replace(/^[ \t]+/, "");
    let contentEnd = member.length;
    while (
      contentEnd > separator + 1 &&
      (member[contentEnd - 1] === " " || member[contentEnd - 1] === "\t")
    ) contentEnd--;
    const content = member.slice(separator + 1, contentEnd);
    const simple = /^[a-z][a-z0-9_*/-]{0,255}$/;
    const multi = /^[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13}$/;
    if ((!simple.test(key) && !multi.test(key)) || keys.has(key)) return false;
    if (
      !content.length ||
      content.length > 256 ||
      !/^[\x20-\x2b\x2d-\x3c\x3e-\x7e]*[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/.test(content)
    ) {
      return false;
    }
    keys.add(key);
  }
  return true;
}
