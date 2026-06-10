export const MAX_CACHE_GLOB_WILDCARDS = 64;

export interface CacheGlob {
  test(value: string): boolean;
}

function matchesGlob(pattern: string, value: string): boolean {
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starValueIndex = 0;

  while (valueIndex < value.length) {
    const patternChar = pattern[patternIndex];

    if (patternChar === "?" || patternChar === value[valueIndex]) {
      patternIndex++;
      valueIndex++;
      continue;
    }

    if (patternChar === "*") {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex++;
      continue;
    }

    if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      starValueIndex++;
      valueIndex = starValueIndex;
      continue;
    }

    return false;
  }

  while (pattern[patternIndex] === "*") patternIndex++;
  return patternIndex === pattern.length;
}

export function compileCacheGlob(pattern: string): CacheGlob | null {
  const wildcardCount = (pattern.match(/[*?]/g) ?? []).length;
  if (wildcardCount > MAX_CACHE_GLOB_WILDCARDS) return null;

  return {
    test(value: string): boolean {
      return matchesGlob(pattern, value);
    },
  };
}
