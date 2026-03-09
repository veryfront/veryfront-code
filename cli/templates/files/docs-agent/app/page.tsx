'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChatWithSidebar, useChat, type QuickAction } from 'veryfront/chat'

const UPLOAD_API = '/api/uploads'
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.mdx,.html,.rtf,.epub,.json,.xml'

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'ask-question', label: 'Ask Question', prompt: 'I have a question about this document: ' },
  { id: 'extract-insights', label: 'Extract Insights', prompt: 'Extract the key insights from the uploaded documents.' },
  { id: 'find-sources', label: 'Find Sources', prompt: 'Find relevant sources and references in the documents for: ' },
]

interface Doc { id: string; title: string; source: string; url?: string }

function useUploads(api: string) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api)
      if (res.ok) {
        const data = await res.json()
        setDocs(Array.isArray(data) ? data : data.uploads ?? [])
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [api, refresh])

  const remove = useCallback(async (id: string) => {
    await fetch(`${api}/${id}`, { method: 'DELETE' })
    await refresh()
  }, [api, refresh])

  const uploads = useMemo(
    () => docs.filter((d) => d.source.startsWith('upload:')),
    [docs],
  )

  return { uploads, uploading, error, upload, remove }
}

export default function DocsChat() {
  const chat = useChat({ api: '/api/chat' })
  const docs = useUploads(UPLOAD_API)

  const attachmentItems = useMemo(() => {
    const items = docs.uploads.map((d) => ({
      id: d.id,
      name: d.title,
      status: 'ready' as const,
    }))
    if (docs.uploading) {
      items.push({ id: '__uploading', name: 'Uploading...', status: 'uploading' as const })
    }
    return items
  }, [docs.uploads, docs.uploading])

  const uploadFiles = useMemo(
    () => docs.uploads.map((d) => ({ id: d.id, name: d.title, url: d.url })),
    [docs.uploads],
  )

  const handleAttach = useCallback((files: FileList) => {
    for (const file of Array.from(files)) {
      docs.upload(file)
    }
  }, [docs.upload])

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action.prompt) chat.setInput(action.prompt)
  }, [chat.setInput])

  return (
    <ChatWithSidebar
      chat={chat}
      sidebar={{ storageKey: 'rag-threads' }}
      features={{ steps: true, tabs: true, sources: true, export: true }}
      models={{
        options: [
          {
            value: 'veryfront-cloud/anthropic/claude-sonnet-4-6',
            label: 'Claude Sonnet',
            provider: 'Veryfront Cloud',
          },
          {
            value: 'veryfront-cloud/openai/gpt-5.2',
            label: 'GPT-5.2',
            provider: 'Veryfront Cloud',
          },
          {
            value: 'veryfront-cloud/google/gemini-2.5-flash',
            label: 'Gemini 2.5 Flash',
            provider: 'Veryfront Cloud',
            badge: 'Fast',
          },
        ],
      }}
      attachments={{
        uploads: uploadFiles,
        onRemoveUpload: docs.remove,
        onAttach: handleAttach,
        accept: ACCEPT,
        items: attachmentItems,
        onRemoveItem: docs.remove,
      }}
      quickActions={{
        actions: QUICK_ACTIONS,
        onAction: handleQuickAction,
      }}
      message={{
        renderTool: () => null,
      }}
      className="flex-1 min-h-0"
      placeholder="Ask anything about your documents..."
      emptyState={{ title: 'Docs Agent', description: 'Upload files and ask questions' }}
    />
  )
}
