'use client'

import { Chat } from 'veryfront/chat'
import { MarkdownRendererProvider } from 'veryfront/markdown'
import { MarkdownRenderer } from './markdown-renderer.tsx'

export default function CodeAgent(): React.JSX.Element {
  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Chat
        agentId="coder"
        api="/api/ag-ui"
        className="flex-1 min-h-0"
        placeholder="Describe what you want to build or fix..."
      />
    </MarkdownRendererProvider>
  )
}
