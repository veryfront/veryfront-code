# @veryfront/ext-markdown-react

Rich Markdown rendering for React surfaces, built on
[react-markdown](https://github.com/remarkjs/react-markdown) and
[remark-gfm](https://github.com/remarkjs/remark-gfm).

Provides the `MarkdownRendererProvider` contract. Chat installs this renderer by
default, so assistant answers render as semantic HTML without any project setup.

## What it renders

- CommonMark: headings, paragraphs, lists, blockquotes, links, images, emphasis,
  inline code, and fenced code.
- GFM: tables, task lists, strikethrough, and autolinks.
- LaTeX math through KaTeX, written as `$$x^2$$` (inline), a `$$` fenced block
  (display), or the `\(x^2\)` and `\[x^2\]` forms models commonly emit.
- Fenced code as `<pre><code class="language-x">`. Pass `renderCodeBlock` to
  supply your own presentation. Chat passes the shared `CodeBlock` primitive,
  which adds a language label, a copy button, and an optional syntax-highlight
  renderer.

### Math delimiters

Single-dollar text math is off. Assistant answers quote currency constantly, and
`$84.50 ... $33.24` in one sentence would otherwise render the text between the
two amounts as an equation. Use `$$` for math; `$` stays literal.

KaTeX emits MathML, so math needs no stylesheet and no web fonts. A malformed
expression renders as its source rather than throwing.

## Safety

- Raw HTML in Markdown source is never injected. `rehype-raw` is not installed,
  so `<script>` in source reaches the DOM as escaped text.
- react-markdown's default URL transform drops unsafe link protocols such as
  `javascript:`.
- Links open in a new tab with `rel="noopener noreferrer"`.

## Use it directly

Chat wires this up for you. Install it explicitly when you render
`veryfront/markdown` outside chat:

```tsx
import { Markdown, MarkdownRendererProvider } from "veryfront/markdown";
import { MarkdownRenderer } from "@veryfront/ext-markdown-react/renderer";

export default function Answer({ source }: { source: string }) {
  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Markdown>{source}</Markdown>
    </MarkdownRendererProvider>
  );
}
```

Import from `@veryfront/ext-markdown-react/renderer` in client code. The package
root additionally exports the extension factory, which pulls in the extension
registry.

## Replace it

Pass your own renderer to `MarkdownRendererProvider` to override this one
everywhere, including inside chat. Pass `renderer={null}` on a single `Markdown`
instance to show plain escaped source instead.

## Test

```bash
deno task test
```
