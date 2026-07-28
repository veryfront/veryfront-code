/**
 * Reject structurally incomplete CSS before handing it to parsers that perform
 * error recovery. This scanner only validates lexical structure; semantic
 * validation remains the parser's responsibility.
 */
export function assertBalancedCssSyntax(
  css: string,
  label = "CSS",
): void {
  if (typeof css !== "string") {
    throw new TypeError(`${label} content must be a string`);
  }

  const stack: string[] = [];
  let quote = "";
  let inComment = false;

  for (let index = 0; index < css.length; index++) {
    const character = css[index]!;
    const next = css[index + 1];

    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && next === "*") {
      inComment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index++;
      continue;
    }

    if (character === "{" || character === "(" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== ")" && character !== "]") {
      continue;
    }

    const expected = character === "}" ? "{" : character === ")" ? "(" : "[";
    if (stack.pop() !== expected) {
      throw new SyntaxError(`${label} contains an unmatched ${character}`);
    }
  }

  if (inComment) throw new SyntaxError(`${label} contains an unterminated comment`);
  if (quote) throw new SyntaxError(`${label} contains an unterminated string`);
  if (stack.length > 0) {
    throw new SyntaxError(`${label} contains an unclosed ${stack.at(-1)}`);
  }
}
