'use client'

import ReactMarkdown from 'react-markdown@9.0.3'
import remarkGfm from 'remark-gfm@4.0.1'
import type { MarkdownRendererProps } from 'veryfront/markdown'

/**
 * Rich Markdown for assistant answers.
 *
 * `veryfront/markdown` presents plain source until a renderer is installed, so
 * this component supplies one. Swap in any renderer that accepts
 * `MarkdownRendererProps` to change how answers are parsed and rendered.
 */
export function MarkdownRenderer({ source }: MarkdownRendererProps): React.JSX.Element {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
}
