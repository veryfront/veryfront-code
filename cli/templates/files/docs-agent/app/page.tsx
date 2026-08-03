'use client'

import { Chat } from 'veryfront/chat'

export default function DocsChat() {
  return (
    <Chat
      agentId="rag"
      api="/api/ag-ui"
      className="flex-1 min-h-0"
      placeholder="Ask anything about your documents..."
    />
  )
}
