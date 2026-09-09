import { privateTextTrim } from "#veryfront/security/private-text.ts";

/** Options accepted by runtime prompt block. */
export type RuntimePromptBlockOptions = {
  name: string;
  content: string;
  attrs?: Record<string, string>;
};

/** Create runtime prompt block. */
export function createRuntimePromptBlock({
  name,
  content,
  attrs,
}: RuntimePromptBlockOptions): string {
  const attrString = attrs
    ? Object.entries(attrs)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join("")
    : "";

  return `<${name}${attrString}>\n${privateTextTrim(content)}\n</${name}>`;
}
