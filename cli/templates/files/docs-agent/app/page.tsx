'use client'

import { Chat } from 'veryfront/chat'

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.mdx,.html,.rtf,.epub,.json,.xml'

export default function DocsChat() {
  return (
    <Chat
      agentId="rag"
      api="/api/ag-ui"
      uploadApi="/api/uploads"
      attachAccept={ACCEPT}
      className="flex-1 min-h-0"
      placeholder="Ask anything about your documents..."
    />
  )
}
