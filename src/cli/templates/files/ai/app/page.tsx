'use client'

import { Chat } from 'veryfront/ai/components'
import { useChat } from 'veryfront/ai/react'

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Header - sticky at top, full width */}
      <header className="sticky top-0 z-10 flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
          <a
            href="/setup"
            className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Setup
          </a>
        </div>
      </header>

      {/* Chat - fills remaining space with scrollable content */}
      <Chat {...chat} className="flex-1 min-h-0" placeholder="Message" />
    </div>
  )
}
