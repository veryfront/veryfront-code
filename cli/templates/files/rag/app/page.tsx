'use client'

import { Chat, useChat } from 'veryfront/chat'

export default function DocsChat(): JSX.Element {
  const chat = useChat({ api: '/api/chat' })

  return <Chat {...chat} className="flex-1 min-h-0" placeholder="Ask a question about your docs..." />
}
