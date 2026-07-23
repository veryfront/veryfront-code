import { MAX_PATH_LENGTH } from "#veryfront/utils";

const MAX_ENCODED_MARKDOWN_PATH_LENGTH = MAX_PATH_LENGTH * 3;

function hasUnsafePathCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Decode one bounded URL path without accepting separators hidden by encoding. */
export function decodeMarkdownPath(pathname: string): string | null {
  if (pathname.length > MAX_ENCODED_MARKDOWN_PATH_LENGTH) return null;

  try {
    const decoded = decodeURIComponent(pathname);
    if (hasUnsafePathCharacters(decoded)) return null;
    return decoded.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

/** Return whether the path belongs to the standalone markdown preview surface. */
export function isStandaloneMarkdownPath(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  const pathname = `/${filePath}`;
  return !pathname.includes("/pages/") &&
    !pathname.includes("/app/") &&
    !pathname.startsWith("/_");
}
