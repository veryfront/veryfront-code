export function wrapInHTML(content, options) {
    const nonceAttr = options.nonce ? ` nonce="${options.nonce}"` : "";
    const metaTags = Object.entries(options.meta)
        .map(([name, metaContent]) => `<meta name="${name}" content="${metaContent}">`)
        .join("\n  ");
    const linkTags = options.links
        .map((link) => `<link rel="${link.rel}" href="${link.href}">`)
        .join("\n  ");
    const scriptTags = options.scripts
        .map((script) => {
        const typeAttr = script.type ? ` type="${script.type}"` : "";
        return `<script src="${script.src}"${typeAttr}${nonceAttr}></script>`;
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
