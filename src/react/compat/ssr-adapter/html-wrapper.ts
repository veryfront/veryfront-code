import { buildAttributes, escapeHTML } from "#veryfront/html/html-escape.ts";
import type { HTMLWrapOptions } from "./types.ts";

export interface HTMLShell {
  prefix: string;
  suffix: string;
}

function attributes(values: Readonly<Record<string, string | undefined>>): string {
  return buildAttributes(
    Object.fromEntries(
      Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  );
}

export function createHTMLShell(options: HTMLWrapOptions): HTMLShell {
  const metaTags = Object.entries(options.meta)
    .map(([name, metaContent]) => `<meta ${attributes({ name, content: metaContent })}>`)
    .join("\n  ");

  const linkTags = options.links
    .map(({ rel, href }) => `<link ${attributes({ rel, href })}>`)
    .join("\n  ");

  const scriptTags = options.scripts
    .map(({ src, type }) => `<script ${attributes({ src, type, nonce: options.nonce })}></script>`)
    .join("\n  ");

  const bootstrapScriptTags = options.bootstrapScripts
    .map((src) => `<script ${attributes({ src, nonce: options.nonce })} async></script>`)
    .join("\n  ");

  return {
    prefix: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(options.title)}</title>
  ${metaTags}
  ${linkTags}
  ${scriptTags}
</head>
<body>
  <div id="root">`,
    suffix: `</div>
  ${bootstrapScriptTags}
</body>
</html>`,
  };
}

export function wrapInHTML(content: string, options: HTMLWrapOptions): string {
  const { prefix, suffix } = createHTMLShell(options);
  return `${prefix}${content}${suffix}`;
}
