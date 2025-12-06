'use client'

import { Chat } from 'veryfront/ai/components'
import { useChat } from 'veryfront/ai/react'

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Header - minimal */}
      <header className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-center">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
        </div>
      </header>

      {/* Chat */}
      <Chat {...chat} className="flex-1" placeholder="Message" />
    </div>
  )
}
