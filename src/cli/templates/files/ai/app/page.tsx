'use client'

import { Chat } from 'veryfront/ai/components'
import { useChat } from 'veryfront/ai/react'

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      <header className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-slate-800 dark:text-white">Veryfront AI</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Powered by Agents & Tools</p>
          </div>
        </div>
      </header>

      <Chat {...chat} className="flex-1" placeholder="Ask me anything..." />
    </div>
  )
}
