# @veryfront/ext-content-mdx

> **Category:** Content | **Contract:** `ContentProcessor` | **Built-in**

Provides MDX and Markdown processing for Veryfront, backed by [`@mdx-js/mdx`](https://github.com/mdx-js/mdx) and the [`unified`](https://unifiedjs.com/) ecosystem. It returns compiled React modules with sanitized HTML output, frontmatter extraction, and heading collection.

## Registration

This extension is auto-enabled by core bootstrap. Add it to `veryfront.config.ts` only when you need to override the built-in registration:

```ts
import extMdx from "@veryfront/ext-content-mdx";

export default defineConfig({
  extensions: [extMdx()],
});
```

## Provided contract

`ContentProcessor` exposes:

- `compileMdx(options)` runs `@mdx-js/mdx` through Veryfront's bundled remark + rehype plugin stack and returns compiled ESM, extracted headings, and frontmatter.
- `compileMarkdown(options)` runs a unified Markdown pipeline (`remark-parse` to `remark-rehype` to `rehype-sanitize` to `rehype-stringify`) producing sanitized HTML wrapped in a React component.
- `getRemarkPlugins()` / `getRehypePlugins()` returns the configured plugin list so callers can build a custom pipeline.

### Import preservation

`compileMdx` accepts `preserveImports: true`. Authored import specifiers remain unchanged for a later scoped resolver. The default is `false`, which retains the server or browser import rewriting. This option does not grant filesystem access.

## Content analysis

Import the analysis API from its dedicated subpath. It does not load the MDX compiler or React runtime.

```ts
import { analyzeContent } from "@veryfront/ext-content-mdx/analysis";

const result = await analyzeContent({
  value: "[Guide](../guides/start.md)",
  syntax: "markdown",
  filePath: "content/guide.md",
});

if (result.kind === "syntax-error") {
  console.error(result.diagnostic.message);
} else {
  console.log(result.destinations);
}
```

Set `syntax` to `"markdown"` or `"mdx"`. You can also pass frontmatter settings with `frontmatter`. A document result contains statically known link, image, JSX, and raw HTML destinations. A syntax error contains one positioned diagnostic.

Offsets are zero-based. Lines and columns are one-based. `rawValue` preserves the authored source. A raw HTML destination also includes `normalizedValue` when Markdown removes container prefixes from a multiline attribute. Static JavaScript strings and templates in MDX include `cookedValue` when their runtime value differs from the authored text.

## Default plugin stack

| Phase  | Plugins                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| remark | `remark-gfm`, `remark-frontmatter`                                                                            |
| rehype | `rehype-slug`, `rehype-highlight`, `rehype-starry-night`, `rehype-raw`, `rehype-sanitize`, `rehype-stringify` |

Pass `plugins.remark` / `plugins.rehype` in `ContentCompileOptions` to extend the stack at the call site.

## Configuration

No factory options. The extension reads no environment variables and takes no config.

## Behavior when missing

If the extension is not installed and core's MDX or Markdown processor is invoked, Veryfront throws an actionable install message pointing to `@veryfront/ext-content-mdx`.
