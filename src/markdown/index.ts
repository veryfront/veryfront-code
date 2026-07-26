/**
 * Server-rendered CommonMark and GitHub Flavored Markdown.
 *
 * Semantic Markdown is rendered synchronously during SSR. Fenced source stays
 * readable while browser-only syntax highlighting and Mermaid rendering load.
 * Raw HTML and unsafe link protocols are not emitted by default.
 *
 * @module markdown
 *
 * @example
 * ```tsx
 * import { Markdown } from "veryfront/markdown";
 *
 * <Markdown># Hello{"\n\n"}Some **bold** text with `code`.</Markdown>
 * ```
 *
 * @see https://veryfront.com/docs/guides/chat-ui
 */

export {
  type CodeBlockProps,
  Markdown,
  type MarkdownProps,
} from "#veryfront/react/components/chat/markdown.tsx";
