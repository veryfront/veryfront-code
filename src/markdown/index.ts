/**
 * Markdown rendering with syntax highlighting and diagrams.
 *
 * @module markdown
 *
 * @example
 * ```tsx
 * import { Markdown } from "veryfront/markdown";
 *
 * <Markdown># Hello{"\n\n"}Some **bold** text with `code`.</Markdown>
 * ```
 */

// veryfront/markdown — Markdown rendering component
//
// Renders markdown strings at runtime with syntax highlighting and
// Mermaid diagram support. Used for displaying AI-generated content.
// For MDX page customization, use veryfront/mdx instead.

export { Markdown } from "#veryfront/react/components/ai/markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "#veryfront/react/components/ai/markdown.tsx";
