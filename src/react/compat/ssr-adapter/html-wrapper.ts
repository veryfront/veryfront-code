import type { HTMLWrapOptions } from "./types.ts";

export function wrapInHTML(content: string, options: HTMLWrapOptions): string {
  const nonceAttr = options.nonce ? ` nonce="${options.nonce}"` : "";

  const metaTags = Object.entries(options.meta)
    .map(([name, metaContent]) => `<meta name="${name}" content="${metaContent}">`)
    .join("\n  ");

  const linkTags = options.links
    .map(({ rel, href }) => `<link rel="${rel}" href="${href}">`)
    .join("\n  ");

  const scriptTags = options.scripts
    .map(({ src, type }) => {
      const typeAttr = type ? ` type="${type}"` : "";
      return `<script src="${src}"${typeAttr}${nonceAttr}></script>`;
    })
    .join("\n  ");

  const bootstrapScriptTags = options.bootstrapScripts
    .map((src) => `<script src="${src}"${nonceAttr} async></script>`)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  ${metaTags}
  ${linkTags}
  ${scriptTags}
</head>
<body>
  <div id="root">${content}</div>
  ${bootstrapScriptTags}
</body>
</html>`;
}
