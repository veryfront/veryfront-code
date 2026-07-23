const WHITESPACE_SENSITIVE_PUNCTUATION = new Set(["{", "}", ":", ";", ",", ">", "~"]);

function needsSeparatingSpace(previous: string | undefined, next: string): boolean {
  if (!previous) return false;
  return !WHITESPACE_SENSITIVE_PUNCTUATION.has(previous) &&
    !WHITESPACE_SENSITIVE_PUNCTUATION.has(next);
}

/**
 * Conservatively minifies CSS without changing text inside quoted values.
 *
 * This is a lexical whitespace and comment pass, not a CSS parser. It avoids
 * value rewrites and leaves whitespace in place whenever removing it could
 * merge two tokens.
 */
export function minifyCSSLexically(
  css: string,
  options: { removeFinalSemicolons?: boolean } = {},
): string {
  let output = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let pendingWhitespace = false;
  const delimiters: string[] = [];
  let escapedOutsideString = false;

  for (let index = 0; index < css.length; index++) {
    const current = css[index];
    if (current === undefined) continue;

    if (quote) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      }
      continue;
    }

    const currentIsEscaped = escapedOutsideString;
    if (currentIsEscaped) {
      escapedOutsideString = false;
    } else if (current === "\\") {
      escapedOutsideString = true;
    }

    if (!currentIsEscaped && current === "/" && css[index + 1] === "*") {
      const commentEnd = css.indexOf("*/", index + 2);
      if (commentEnd === -1) throw new SyntaxError("Unterminated CSS comment");
      pendingWhitespace = output.length > 0;
      index = commentEnd + 1;
      continue;
    }

    if (/\s/.test(current)) {
      pendingWhitespace = output.length > 0;
      continue;
    }

    if (!currentIsEscaped && current !== "\\") {
      const closingDelimiter = current === "{"
        ? "}"
        : current === "("
        ? ")"
        : current === "["
        ? "]"
        : undefined;
      if (closingDelimiter) {
        delimiters.push(closingDelimiter);
      } else if (current === "}" || current === ")" || current === "]") {
        const expected = delimiters.pop();
        if (expected !== current) throw new SyntaxError(`Unexpected CSS delimiter: ${current}`);
      }
    }

    if (pendingWhitespace && needsSeparatingSpace(output.at(-1), current)) output += " ";
    pendingWhitespace = false;

    if (
      !currentIsEscaped && options.removeFinalSemicolons !== false && current === "}" &&
      output.endsWith(";")
    ) {
      output = output.slice(0, -1);
    }

    output += current;
    if (!currentIsEscaped && (current === '"' || current === "'")) quote = current;
  }

  if (quote) throw new SyntaxError("Unterminated CSS string");
  if (delimiters.length > 0) {
    throw new SyntaxError(`Unterminated CSS delimiter: expected ${delimiters.at(-1)}`);
  }
  return output.trim();
}
