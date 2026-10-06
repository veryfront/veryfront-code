type GlobToken =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "any-segment-character" }
  | { readonly kind: "any-segment-characters" }
  | { readonly kind: "any-characters" }
  | { readonly kind: "directory-globstar" };

const reflectApply = Reflect.apply;
const stringIndexOf = String.prototype.indexOf;

function appendLiteral(tokens: GlobToken[], value: string): void {
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === "literal") {
    tokens[tokens.length - 1] = { kind: "literal", value: previous.value + value };
    return;
  }
  tokens[tokens.length] = { kind: "literal", value };
}

function compileGlobTokens(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (character === "*") {
      if (pattern.charAt(index + 1) === "*") {
        if (pattern.charAt(index + 2) === "/") {
          tokens[tokens.length] = { kind: "directory-globstar" };
          index += 2;
        } else {
          tokens[tokens.length] = { kind: "any-characters" };
          index += 1;
        }
      } else {
        tokens[tokens.length] = { kind: "any-segment-characters" };
      }
      continue;
    }

    if (character === "?") {
      tokens[tokens.length] = { kind: "any-segment-character" };
      continue;
    }

    appendLiteral(tokens, character);
  }
  return tokens;
}

function nextSlashIndex(value: string, start: number): number {
  return reflectApply(stringIndexOf, value, ["/", start]) as number;
}

export type GlobMatcher = (value: string) => boolean;

export function compileGlobMatcher(pattern: string): GlobMatcher {
  const tokens = compileGlobTokens(pattern);
  return (value: string): boolean => {
    const memo = new Map<string, boolean>();

    const matchesFrom = (tokenIndex: number, valueIndex: number): boolean => {
      const memoKey = `${tokenIndex}:${valueIndex}`;
      const cached = memo.get(memoKey);
      if (cached !== undefined) return cached;

      let matched = false;
      const token = tokens[tokenIndex];
      if (token === undefined) {
        matched = valueIndex === value.length;
      } else if (token.kind === "literal") {
        matched = value.startsWith(token.value, valueIndex) &&
          matchesFrom(tokenIndex + 1, valueIndex + token.value.length);
      } else if (token.kind === "any-segment-character") {
        matched = valueIndex < value.length && value.charAt(valueIndex) !== "/" &&
          matchesFrom(tokenIndex + 1, valueIndex + 1);
      } else if (token.kind === "any-segment-characters") {
        matched = matchesFrom(tokenIndex + 1, valueIndex) ||
          (valueIndex < value.length && value.charAt(valueIndex) !== "/" &&
            matchesFrom(tokenIndex, valueIndex + 1));
      } else if (token.kind === "any-characters") {
        matched = matchesFrom(tokenIndex + 1, valueIndex) ||
          (valueIndex < value.length && matchesFrom(tokenIndex, valueIndex + 1));
      } else {
        const slashIndex = nextSlashIndex(value, valueIndex);
        matched = matchesFrom(tokenIndex + 1, valueIndex) ||
          (slashIndex > valueIndex && matchesFrom(tokenIndex, slashIndex + 1));
      }

      memo.set(memoKey, matched);
      return matched;
    };

    return matchesFrom(0, 0);
  };
}

export function globMatches(pattern: string, value: string): boolean {
  return compileGlobMatcher(pattern)(value);
}
