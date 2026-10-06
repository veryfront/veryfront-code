type GlobToken =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "any-segment-character" }
  | { readonly kind: "any-segment-characters" }
  | { readonly kind: "any-characters" }
  | { readonly kind: "directory-globstar" };

const reflectApply = Reflect.apply;
const SafeMap = Map;
const stringCharAt = String.prototype.charAt;
const stringIndexOf = String.prototype.indexOf;
const stringStartsWith = String.prototype.startsWith;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;

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
    const character = reflectApply(stringCharAt, pattern, [index]) as string;
    if (character === "*") {
      if ((reflectApply(stringCharAt, pattern, [index + 1]) as string) === "*") {
        if ((reflectApply(stringCharAt, pattern, [index + 2]) as string) === "/") {
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

function mapGetValue<K, V>(map: Map<K, V>, key: K): V | undefined {
  return reflectApply(mapGet, map, [key]) as V | undefined;
}

function mapSetValue<K, V>(map: Map<K, V>, key: K, value: V): void {
  reflectApply(mapSet, map, [key, value]);
}

function stringHasPrefixAt(value: string, prefix: string, position: number): boolean {
  return reflectApply(stringStartsWith, value, [prefix, position]) as boolean;
}

function stringCharacterAt(value: string, index: number): string {
  return reflectApply(stringCharAt, value, [index]) as string;
}

export type GlobMatcher = (value: string) => boolean;

export function compileGlobMatcher(pattern: string): GlobMatcher {
  const tokens = compileGlobTokens(pattern);
  return (value: string): boolean => {
    const memo = new SafeMap<string, boolean>();

    const matchesFrom = (tokenIndex: number, valueIndex: number): boolean => {
      const memoKey = `${tokenIndex}:${valueIndex}`;
      const cached = mapGetValue(memo, memoKey);
      if (cached !== undefined) return cached;

      let matched = false;
      const token = tokens[tokenIndex];
      if (token === undefined) {
        matched = valueIndex === value.length;
      } else if (token.kind === "literal") {
        matched = stringHasPrefixAt(value, token.value, valueIndex) &&
          matchesFrom(tokenIndex + 1, valueIndex + token.value.length);
      } else if (token.kind === "any-segment-character") {
        matched = valueIndex < value.length && stringCharacterAt(value, valueIndex) !== "/" &&
          matchesFrom(tokenIndex + 1, valueIndex + 1);
      } else if (token.kind === "any-segment-characters") {
        matched = matchesFrom(tokenIndex + 1, valueIndex) ||
          (valueIndex < value.length && stringCharacterAt(value, valueIndex) !== "/" &&
            matchesFrom(tokenIndex, valueIndex + 1));
      } else if (token.kind === "any-characters") {
        matched = matchesFrom(tokenIndex + 1, valueIndex) ||
          (valueIndex < value.length && matchesFrom(tokenIndex, valueIndex + 1));
      } else {
        const slashIndex = nextSlashIndex(value, valueIndex);
        matched = matchesFrom(tokenIndex + 1, valueIndex) ||
          (slashIndex > valueIndex && matchesFrom(tokenIndex, slashIndex + 1));
      }

      mapSetValue(memo, memoKey, matched);
      return matched;
    };

    return matchesFrom(0, 0);
  };
}

export function globMatches(pattern: string, value: string): boolean {
  return compileGlobMatcher(pattern)(value);
}
