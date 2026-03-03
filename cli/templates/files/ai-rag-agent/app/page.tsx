'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Chat, useChat } from 'veryfront/chat'

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

export default function DocsChat(): JSX.Element {
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

  return (
    <Chat
      {...chat}
      className="flex-1 min-h-0"
      placeholder="Ask about your docs..."
      renderTool={() => null}
      showSources
      emptyState={{ title: 'Docs Q&A', description: 'Upload documents and ask questions' }}
      suggestions={['What is this about?', 'Summarize the key points']}
      onSuggestionClick={(s) => { chat.setInput(s); }}
      onAttach={(files) => {
        for (const file of Array.from(files)) {
          docs.upload(file)
        }
      }}
      attachAccept=".pdf,.docx,.csv,.txt,.md,.mdx"
      attachments={attachments}
      onRemoveAttachment={(id) => docs.remove(id)}
    />
  )
}
