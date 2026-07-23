/**
 * Markdown rendering with GFM, syntax highlighting, and Mermaid diagrams.
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

export {
  type CodeBlockProps,
  type Components,
  Markdown,
  type MarkdownProps,
  type PluggableList,
} from "#veryfront/react/components/chat/markdown.tsx";
