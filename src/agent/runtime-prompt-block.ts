export type RuntimePromptBlockOptions = {
  name: string;
  content: string;
  attrs?: Record<string, string>;
};

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

  return `<${name}${attrString}>\n${content.trim()}\n</${name}>`;
}
