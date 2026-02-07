'use client'

import { Chat, useChat } from 'veryfront/chat'

export default function ChatPage(): JSX.Element {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-900">
      <header className="sticky top-0 z-10 flex-shrink-0 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
          <a
            href="/setup"
            className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Setup
          </a>
        </div>
      </header>

      <Chat {...chat} className="min-h-0 flex-1" placeholder="Message" />
    </div>
  )
}
