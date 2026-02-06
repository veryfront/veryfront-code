'use client'

import { Chat } from 'veryfront/components/ai'
import { useChat } from 'veryfront/agent/react'

export default function ChatPage(): JSX.Element {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      <header className="sticky top-0 z-10 flex-shrink-0 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
        </div>
      </header>

      <Chat {...chat} className="flex-1 min-h-0" placeholder="Message" />
    </div>
  )
}
