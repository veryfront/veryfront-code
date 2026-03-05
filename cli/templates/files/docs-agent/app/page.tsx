'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChatWithSidebar, useChat, type QuickAction } from 'veryfront/chat'

interface Doc { id: string; title: string; source: string }

function useUploads(api: string) {
  const [uploads, setUploads] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api)
      if (res.ok) {
        const data = await res.json()
        setUploads(Array.isArray(data) ? data : data.uploads ?? [])
      }
    } catch { /* ignore */ }
  }, [api])

  useEffect(() => { refresh() }, [refresh])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(api, { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') }
    finally { setUploading(false) }
  }, [api, refresh])

  const remove = useCallback(async (id: string) => {
    await fetch(`${api}/${id}`, { method: 'DELETE' })
    await refresh()
  }, [api, refresh])

  return { uploads, uploading, error, upload, remove }
}

export default function DocsChat() {
  const chat = useChat({ api: '/api/chat' })
  const docs = useUploads('/api/uploads')

  const uploads = docs.uploads.filter((d) => d.source.startsWith('upload:'))

  const attachments = uploads.map((d) => ({
    id: d.id,
    name: d.title,
    status: 'ready' as const,
  }))

  if (docs.uploading) {
    attachments.push({ id: '__uploading', name: 'Uploading...', status: 'uploading' as const })
  }

  const quickActions: QuickAction[] = [
    { id: 'ask-question', label: 'Ask Question', prompt: 'I have a question about this document: ' },
    { id: 'extract-insights', label: 'Extract Insights', prompt: 'Extract the key insights from the uploaded documents.' },
    { id: 'find-sources', label: 'Find Sources', prompt: 'Find relevant sources and references in the documents for: ' },
  ]

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action.prompt) chat.setInput(action.prompt)
  }, [chat])

  const docFiles = uploads.map((d) => ({
    id: d.id,
    name: d.title,
  }))

  return (
    <ChatWithSidebar
      chat={chat}
      sidebar={{ storageKey: 'rag-threads' }}
      features={{ steps: true, tabs: true, sources: true, export: true }}
      models={{
        options: [
          { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'Anthropic' },
          { value: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
          { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', badge: 'Fast' },
          { value: 'openai/gpt-5.2', label: 'GPT-5.2', provider: 'OpenAI' },
        ],
      }}
      attachments={{
        uploads: docFiles,
        onRemoveUpload: (id) => docs.remove(id),
        onAttach: (files) => {
          for (const file of Array.from(files)) {
            docs.upload(file)
          }
        },
        accept: '.pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.mdx,.html,.rtf,.epub,.json,.xml',
        items: attachments,
        onRemoveItem: (id) => docs.remove(id),
      }}
      quickActions={{
        actions: quickActions,
        onAction: handleQuickAction,
      }}
      message={{
        renderTool: () => null,
        onFeedback: (messageId, feedback) => {
          console.log(`Feedback: ${feedback} on message ${messageId}`)
        },
      }}
      className="flex-1 min-h-0"
      placeholder="Ask anything about your documents..."
      emptyState={{ title: 'Docs Agent', description: 'Upload files and ask questions' }}
    />
  )
}
