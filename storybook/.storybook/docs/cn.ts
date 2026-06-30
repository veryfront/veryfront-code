// Minimal, dependency-free class-name joiner. Studio's docs kit imports `cn`
// from `@/shared/utils/classname` (banned here), so the kit uses this instead.
export function cn(...a: Array<string | false | null | undefined>): string {
  return a.filter(Boolean).join(" ");
}
