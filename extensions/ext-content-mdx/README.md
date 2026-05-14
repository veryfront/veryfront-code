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
