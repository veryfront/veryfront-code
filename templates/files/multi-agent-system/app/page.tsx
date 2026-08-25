'use client'

import { Chat } from 'veryfront/chat'
import { MarkdownRendererProvider } from 'veryfront/markdown'
import { MarkdownRenderer } from './markdown-renderer.tsx'

export default function MultiAgentChat(): React.JSX.Element {
  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Chat
        agentId="orchestrator"
        api="/api/ag-ui"
        className="flex-1 min-h-0"
        placeholder="Give the team a task..."
      />
    </MarkdownRendererProvider>
  )
}
