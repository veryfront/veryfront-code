import { canParse, parse, parseRange, satisfies as matchesRange } from "#std/semver";

const ReflectApply = Reflect.apply;
const StringReplace = String.prototype.replace;

function normalizePrefix(value: string): string {
  return ReflectApply(StringReplace, value, [/^([~^]?)v(?=\d)/, "$1"]);
}

/** Whether a declaration names one exact semantic version. */
export function valid(value: string): boolean {
  return canParse(normalizePrefix(value));
}

/** Match a version against the standard semantic-version range grammar. */
export function satisfies(version: string, declaration: string): boolean {
  try {
    return matchesRange(parse(normalizePrefix(version)), parseRange(normalizePrefix(declaration)));
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}
