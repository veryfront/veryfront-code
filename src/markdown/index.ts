/**
 * Dependency-free Markdown source presentation for React.
 *
 * Core renders escaped source explicitly. Semantic Markdown is an optional
 * capability supplied by a trusted extension through
 * `MarkdownRendererProvider` or the per-component `renderer` prop.
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
 * @see https://veryfront.com/docs/code/guides/chat-ui
 */

export {
  type CodeBlockProps,
  type Components,
  Markdown,
  type MarkdownComponents,
  type MarkdownElementRendererProps,
  type MarkdownProps,
  type MarkdownRenderer,
  MarkdownRendererCapabilityError,
  type MarkdownRendererProps,
  MarkdownRendererProvider,
  type MarkdownRendererProviderProps,
} from "#veryfront/react/components/chat/markdown.tsx";
