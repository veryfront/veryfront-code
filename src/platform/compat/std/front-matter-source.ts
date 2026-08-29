export interface FrontMatterSource {
  readonly body: string;
  readonly bodyStart: number;
  readonly frontMatter: string;
  readonly frontMatterStart: number;
}

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)([\s\S]*)$/;

/** Match the exact source boundary used by Veryfront's frontmatter compiler. */
export function matchFrontMatterSource(text: string): FrontMatterSource | undefined {
  const match = FRONT_MATTER_PATTERN.exec(text);
  if (match === null) return undefined;

  const frontMatter = match[1] ?? "";
  const body = match[2] ?? "";
  return {
    body,
    bodyStart: text.length - body.length,
    frontMatter,
    frontMatterStart: text.startsWith("---\r\n") ? 5 : 4,
  };
}
