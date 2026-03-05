'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChatWithSidebar, useChat, type QuickAction } from 'veryfront/chat'

interface Doc { id: string; title: string; source: string }

function useDocuments(api: string) {
  const [documents, setDocuments] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api)
      if (res.ok) {
        const data = await res.json()
        setDocuments(Array.isArray(data) ? data : data.documents ?? [])
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

  return { documents, uploading, error, upload, remove }
}

export default function DocsChat() {
  const chat = useChat({ api: '/api/chat' })
  const docs = useDocuments('/api/documents')

  const uploads = docs.documents.filter((d) => d.source.startsWith('upload:'))

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
      {...chat}
      setMessages={chat.setMessages}
      storageKey="rag-threads"
      showSteps
      showTabs
      documents={docFiles}
      onRemoveDocument={(id) => docs.remove(id)}
      quickActions={quickActions}
      onQuickAction={handleQuickAction}
      models={[
        { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'Anthropic' },
        { value: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', badge: 'Fast' },
        { value: 'openai/gpt-5.2', label: 'GPT-5.2', provider: 'OpenAI' },
      ]}
      className="flex-1 min-h-0"
      placeholder="Start with describing your idea..."
      renderTool={() => null}
      showSources
      showExport
      emptyState={{ title: 'Docs Q&A', description: 'Upload documents and ask questions' }}
      onAttach={(files) => {
        for (const file of Array.from(files)) {
          docs.upload(file)
        }
      }}
      attachAccept=".pdf,.docx,.csv,.txt,.md,.mdx"
      attachments={attachments}
      onRemoveAttachment={(id) => docs.remove(id)}
      onFeedback={(messageId, feedback) => {
        console.log(`Feedback: ${feedback} on message ${messageId}`)
      }}
      editMessage={chat.editMessage}
      getBranches={chat.getBranches}
      switchBranch={chat.switchBranch}
    />
  )
}
