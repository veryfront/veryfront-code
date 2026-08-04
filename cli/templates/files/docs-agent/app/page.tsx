'use client'

import { Chat } from 'veryfront/chat'
import { MarkdownRendererProvider } from 'veryfront/markdown'
import { MarkdownRenderer } from './markdown-renderer.tsx'

export default function DocsChat(): React.JSX.Element {
  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Chat
        agentId="rag"
        api="/api/ag-ui"
        className="flex-1 min-h-0"
        placeholder="Ask anything about your documents..."
      />
    </MarkdownRendererProvider>
  )
}
