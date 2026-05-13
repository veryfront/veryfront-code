# @veryfront/ext-transform-mdx

> **Type:** Content | **Contract:** `ContentTransformer`

Provides MDX and Markdown compilation for Veryfront, backed by [`@mdx-js/mdx`](https://github.com/mdx-js/mdx) and the [`unified`](https://unifiedjs.com/) ecosystem. Compiles content into runtime React bundles with sanitized HTML output, frontmatter extraction, and heading collection.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extMdx from "@veryfront/ext-transform-mdx";

export default defineConfig({
  extensions: [extMdx()],
});
```

## Provided contract

`ContentTransformer` — exposes:

- `compileMdx(options)` — runs `@mdx-js/mdx` through Veryfront's bundled remark + rehype plugin stack and returns compiled ESM, extracted headings, and frontmatter.
- `compileMarkdown(options)` — runs a unified Markdown pipeline (`remark-parse` → `remark-rehype` → `rehype-sanitize` → `rehype-stringify`) producing sanitized HTML wrapped in a React component.
- `getRemarkPlugins()` / `getRehypePlugins()` — returns the configured plugin list so callers can build a custom pipeline.

## Default plugin stack

| Phase  | Plugins                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| remark | `remark-gfm`, `remark-frontmatter`                                                                            |
| rehype | `rehype-slug`, `rehype-highlight`, `rehype-starry-night`, `rehype-raw`, `rehype-sanitize`, `rehype-stringify` |

Pass `plugins.remark` / `plugins.rehype` in `ContentCompileOptions` to extend the stack at the call site.

## Configuration

No factory options. The extension reads no environment variables and takes no config.

## Behavior when missing

If the extension is not installed and core's MDX or Markdown transformer is invoked, Veryfront throws an actionable install message pointing to `@veryfront/ext-transform-mdx`.
