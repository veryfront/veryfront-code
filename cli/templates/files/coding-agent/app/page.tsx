'use client'

import { Chat, useChat } from 'veryfront/chat'

export default function CodeAgent(): JSX.Element {
  const chat = useChat({ api: '/api/chat' })

  return (
    <Chat
      {...chat}
      className="flex-1 min-h-0"
      placeholder="Describe what you want to build or fix..."
    />
  )
}
