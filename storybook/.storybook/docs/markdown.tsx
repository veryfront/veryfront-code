import type * as React from "react";
import { cn } from "./cn";
import { DocsSurface } from "./DocsSurface";

/** Markdown / raw-HTML element renderers used by Storybook docs pages.
 *  Can be wired into `parameters.docs.components` so that `### Heading`,
 *  `<h3>Heading</h3>`, and `<DocsH3>Heading</DocsH3>` all render identically.
 *  Same goes for tables, paragraphs, lists, etc. */

export function DocsH2(
  { children, className, ...rest }: React.ComponentProps<"h2">,
) {
  return (
    <h2
      className={cn(
        "mt-10 mb-3 text-2xl font-medium tracking-tight text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}

export function DocsH3(
  { children, className, ...rest }: React.ComponentProps<"h3">,
) {
  return (
    <h3
      className={cn(
        "mt-8 mb-3 text-base font-medium tracking-tight text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function DocsH4(
  { children, className, ...rest }: React.ComponentProps<"h4">,
) {
  return (
    <h4
      className={cn(
        "mt-6 mb-2 text-sm font-medium tracking-tight text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </h4>
  );
}

export function DocsP(
  { children, className, ...rest }: React.ComponentProps<"p">,
) {
  return (
    <p
      className={cn(
        "mb-4 text-base leading-relaxed text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </p>
  );
}

export function DocsBlockquote(
  { children, className, ...rest }: React.ComponentProps<"blockquote">,
) {
  return (
    <blockquote
      className={cn(
        "sb-unstyled my-4 rounded-md border border-outline-border bg-card px-5 py-4 text-lg leading-relaxed text-muted-foreground [&>p]:m-0 [&>p]:text-lg [&>p]:leading-relaxed [&>p]:text-muted-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </blockquote>
  );
}

export function DocsUl(
  { children, className, ...rest }: React.ComponentProps<"ul">,
) {
  return (
    <ul
      className={cn(
        "mb-4 ml-5 list-disc space-y-1.5 text-base leading-relaxed text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </ul>
  );
}

export function DocsOl(
  { children, className, ...rest }: React.ComponentProps<"ol">,
) {
  return (
    <ol
      className={cn(
        "mb-4 ml-5 list-decimal space-y-1.5 text-base leading-relaxed text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </ol>
  );
}

export function DocsLi(
  { children, className, ...rest }: React.ComponentProps<"li">,
) {
  return (
    <li
      className={cn("text-base leading-relaxed text-foreground", className)}
      {...rest}
    >
      {children}
    </li>
  );
}

export function DocsStrong(
  { children, className, ...rest }: React.ComponentProps<"strong">,
) {
  return (
    <strong
      className={cn("font-medium text-foreground", className)}
      {...rest}
    >
      {children}
    </strong>
  );
}

export function DocsHr({ className, ...rest }: React.ComponentProps<"hr">) {
  return <hr className={cn("my-12 border-edge", className)} {...rest} />;
}

export function DocsCodeInline({
  children,
  className,
  node: _node,
  ...rest
}: React.ComponentProps<"code"> & { node?: unknown }) {
  // react-markdown emits fenced blocks as <pre><code class="language-X">…</code></pre>.
  // Skip the inline-pill styling for block code so <pre> styling owns the look.
  const isBlock = typeof className === "string" &&
    /\blanguage-/.test(className);
  if (isBlock) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  return (
    <code
      className={cn(
        "rounded bg-tint px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </code>
  );
}

/**
 * Render a plain string as docs prose, turning `backtick` spans into inline
 * code. Components that accept a string `description`/`title` run it through
 * this so `foo` renders as a code pill, identical to markdown-authored inline
 * code. Non-string nodes are returned unchanged.
 */
export function renderInlineCode(text: React.ReactNode): React.ReactNode {
  if (typeof text !== "string" || !text.includes("`")) return text;
  // Split on backtick-delimited spans, keeping the captured inner text.
  const parts = text.split(/`([^`]+)`/g);
  return parts.map((part, i) =>
    // Odd indices are the captured code spans; even indices are plain text.
    i % 2 === 1 ? <DocsCodeInline key={i}>{part}</DocsCodeInline> : part
  );
}

export function DocsTable(
  { children, className, ...rest }: React.ComponentProps<"table">,
) {
  return (
    <DocsSurface>
      <table className={cn("w-full border-collapse", className)} {...rest}>
        {children}
      </table>
    </DocsSurface>
  );
}

export function DocsThead(
  { children, className, ...rest }: React.ComponentProps<"thead">,
) {
  return (
    <thead className={className} {...rest}>
      {children}
    </thead>
  );
}

export function DocsTbody(
  { children, className, ...rest }: React.ComponentProps<"tbody">,
) {
  return (
    <tbody className={className} {...rest}>
      {children}
    </tbody>
  );
}

export function DocsTr(
  { children, className, ...rest }: React.ComponentProps<"tr">,
) {
  return (
    <tr className={cn("last:[&>td]:border-b-0", className)} {...rest}>
      {children}
    </tr>
  );
}

export function DocsTh(
  { children, className, ...rest }: React.ComponentProps<"th">,
) {
  return (
    <th
      className={cn(
        "border-b border-outline-border px-4 py-2.5 text-left text-sm font-medium text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function DocsTd(
  { children, className, ...rest }: React.ComponentProps<"td">,
) {
  return (
    <td
      className={cn(
        "border-b border-outline-border px-4 py-2.5 align-top text-base text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Single map for Storybook's docs.components parameter so raw markdown / HTML
 *  elements get our styled equivalents. Keep this list in sync when adding new
 *  primitives so every authoring path stays equivalent. */
export const docsMarkdownComponents = {
  h2: DocsH2,
  h3: DocsH3,
  h4: DocsH4,
  p: DocsP,
  blockquote: DocsBlockquote,
  ul: DocsUl,
  ol: DocsOl,
  li: DocsLi,
  strong: DocsStrong,
  hr: DocsHr,
  code: DocsCodeInline,
  table: DocsTable,
  thead: DocsThead,
  tbody: DocsTbody,
  tr: DocsTr,
  th: DocsTh,
  td: DocsTd,
};
