import type { HTMLWrapOptions } from "./types.ts";

export function wrapInHTML(content: string, options: HTMLWrapOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  ${
    Object.entries(options.meta)
      .map(([name, content]) => `<meta name="${name}" content="${content}">`)
      .join("\n  ")
  }
  ${options.links.map((link) => `<link rel="${link.rel}" href="${link.href}">`).join("\n  ")}
  ${
    options.scripts
      .map(
        (script) =>
          `<script src="${script.src}"${script.type ? ` type="${script.type}"` : ""}${
            options.nonce ? ` nonce="${options.nonce}"` : ""
          }></script>`,
      )
      .join("\n  ")
  }
</head>
<body>
  <div id="root">${content}</div>
  ${
    options.bootstrapScripts
      .map(
        (src) =>
          `<script src="${src}"${options.nonce ? ` nonce="${options.nonce}"` : ""} async></script>`,
      )
      .join("\n  ")
  }
</body>
</html>`;
}
