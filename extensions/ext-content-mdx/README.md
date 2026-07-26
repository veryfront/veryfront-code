# @veryfront/ext-content-mdx

> **Category:** Content | **Contract:** `ContentProcessor` | **Built-in**

Provides MDX and Markdown processing for Veryfront, backed by [`@mdx-js/mdx`](https://github.com/mdx-js/mdx) and the [`unified`](https://unifiedjs.com/) ecosystem. It returns compiled React modules, frontmatter, and heading metadata. The plain-Markdown path sanitizes generated HTML; MDX is application code and is not an untrusted-string sanitizer.

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

- `extractFrontmatter(options)` parses YAML plus syntax-aware static metadata without treating rendered examples, comments, expressions, or malformed documents as declarations.
- `compileMdx(options)` runs `@mdx-js/mdx` through Veryfront's bundled remark + rehype plugin stack and returns compiled ESM, extracted headings, and frontmatter.
- `compileMarkdown(options)` runs a unified Markdown pipeline (`remark-parse` to `remark-rehype` to `rehype-sanitize` to `rehype-stringify`) producing sanitized HTML wrapped in a React component.
- `getRemarkPlugins()` / `getRehypePlugins()` return the configured plugin list so callers can build a custom pipeline.

## Default plugin stack

| Pipeline | Phase  | Plugins                                                                                                    |
| -------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| MDX      | remark | `remark-gfm`, `remark-frontmatter`, heading collection, paragraph normalization, code-block metadata       |
| MDX      | rehype | `rehype-highlight`, `rehype-slug`                                                                          |
| Markdown | remark | `remark-parse`, `remark-gfm`, `remark-frontmatter`, heading collection                                     |
| Markdown | rehype | `remark-rehype`, `rehype-starry-night`, `rehype-slug`, `rehype-raw`, `rehype-sanitize`, `rehype-stringify` |

`remarkPlugins` and `rehypePlugins` append caller-owned Unified plugins in list order. Entries may be plugins or `[plugin, ...parameters]` tuples. Markdown rehype plugins run before the final sanitizer. MDX plugins operate on application-authored executable content and are not sandboxed.

## Frontmatter

YAML frontmatter and supplied `frontmatter` objects are supported. MDX and Markdown also accept a single-line top-level `export const` whose value is a static string, finite number, boolean, `null`, or interpolation-free template string. Exported values override supplied values, which override YAML values.

Export-shaped text inside code blocks, comments, JSX, or MDX expressions remains content. If the surrounding document cannot be parsed safely, metadata preprocessing leaves candidate exports unchanged so the compiler reports the syntax error.

## Generated module values

`moduleValues` is available only for MDX program output. Bindings and named exports must use valid JavaScript identifiers and finite JSON data composed of plain objects, dense arrays, and data properties. Dates become ISO strings. Accessors, symbols, cycles, sparse arrays, class instances, non-finite numbers, duplicate binding/export names, and collisions with authored module declarations are rejected.

The built-in processor emits the portable `react/jsx-runtime` transform in both build modes. `mode` is build context; it does not select a second React development-runtime instance.

## Configuration

No factory options. The extension reads no environment variables and takes no config.

## Behavior when missing

If the extension is not installed and core's MDX or Markdown processor is invoked, Veryfront throws an actionable install message pointing to `@veryfront/ext-content-mdx`.
