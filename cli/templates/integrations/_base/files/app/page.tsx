'use client'

import { useEffect, useState } from 'react'
import { Chat, useChat } from 'veryfront/chat'

interface Integration {
  id: string
  name: string
  connected: boolean
  connectUrl: string
}

export default function ChatPage(): React.ReactElement {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      <header className="sticky top-0 z-10 flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
          <div className="flex items-center gap-4">
            <ServiceStatusFromAPI />
            <a
              href="/setup"
              className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Setup
            </a>
          </div>
        </div>
      </header>

      <Chat {...chat} className="flex-1 min-h-0" placeholder="Message" />
    </div>
  )
}

function ServiceStatusFromAPI(): React.ReactElement | null {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect((): void => {
    async function fetchStatus(): Promise<void> {
      try {
        const res = await fetch('/api/integrations/status')
        if (!res.ok) return

        const data = await res.json()
        setIntegrations(data.integrations ?? [])
      } catch (error) {
        console.error('Failed to fetch integration status:', error)
      } finally {
        setLoading(false)
      }
    }

    void fetchStatus()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="animate-pulse h-6 w-24 bg-neutral-200 dark:bg-neutral-700 rounded-full" />
      </div>
    )
  }

  if (integrations.length === 0) return null

  const connected: Integration[] = []
  const disconnected: Integration[] = []

  for (const integration of integrations) {
    if (integration.connected) connected.push(integration)
    else disconnected.push(integration)
  }

  return (
    <div className="flex items-center gap-2">
      {connected.map(service => (
        <span
          key={service.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
          title={`${service.name} connected`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          {service.name}
        </span>
      ))}

      {disconnected.map(service => (
        <a
          key={service.id}
          href={service.connectUrl}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 transition-colors"
          title={`Connect ${service.name}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
          {service.name}
        </a>
      ))}

      {disconnected.length > 0 && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {connected.length}/{integrations.length}
        </span>
      )}
    </div>
  )
}
