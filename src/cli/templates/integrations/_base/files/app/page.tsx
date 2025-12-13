'use client'

import { Chat } from 'veryfront/ai/components'
import { useChat } from 'veryfront/ai/react'
import { ServiceConnections } from './components/ServiceConnections'

const SERVICES = [
  // Services will be dynamically populated based on installed integrations
  // For now, we fetch from the status API instead
]

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' })

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Header - sticky at top, full width */}
      <header className="sticky top-0 z-10 flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
          <div className="flex items-center gap-4">
            <IntegrationStatus />
            <a
              href="/setup"
              className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Setup
            </a>
          </div>
        </div>
      </header>

      {/* Chat - fills remaining space with scrollable content */}
      <Chat {...chat} className="flex-1 min-h-0" placeholder="Message" />
    </div>
  )
}

function IntegrationStatus() {
  // Note: ServiceConnections fetches from /api/auth/status
  return <ServiceStatusFromAPI />
}

import { useEffect, useState } from 'react'

interface Integration {
  id: string
  name: string
  connected: boolean
  connectUrl: string
}

function ServiceStatusFromAPI() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/integrations/status')
        if (res.ok) {
          const data = await res.json()
          setIntegrations(data.integrations || [])
        }
      } catch (error) {
        console.error('Failed to fetch integration status:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchStatus()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="animate-pulse h-6 w-24 bg-neutral-200 dark:bg-neutral-700 rounded-full" />
      </div>
    )
  }

  if (integrations.length === 0) {
    return null
  }

  const connected = integrations.filter(i => i.connected)
  const disconnected = integrations.filter(i => !i.connected)

  return (
    <div className="flex items-center gap-2">
      {/* Show connected services as green badges */}
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

      {/* Show disconnected services as clickable grey badges */}
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

      {/* Show count if not all connected */}
      {disconnected.length > 0 && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {connected.length}/{integrations.length}
        </span>
      )}
    </div>
  )
}
