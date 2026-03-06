'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChatWithSidebar, useChat, type QuickAction } from 'veryfront/chat'

const UPLOAD_API = '/api/uploads'
const ACCEPT = '.pdf,.doc,.docx,.txt,.md,.rtf,.html'

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'full-review', label: 'Full Review', prompt: 'Review this contract clause by clause. Flag deviations as GREEN/YELLOW/RED and provide redline suggestions for any issues.' },
  { id: 'liability-check', label: 'Liability Analysis', prompt: 'Analyze the limitation of liability and indemnification clauses. Are the caps adequate? Are there asymmetric carveouts?' },
  { id: 'ip-review', label: 'IP & Data Review', prompt: 'Review the intellectual property and data protection clauses. Are there any IP assignment risks or missing DPA requirements?' },
  { id: 'termination', label: 'Term & Termination', prompt: 'Analyze the term, renewal, and termination provisions. What are the exit options and notice requirements?' },
  { id: 'redlines', label: 'Generate Redlines', prompt: 'Generate prioritized redline suggestions for all YELLOW and RED issues found in this contract.' },
]

interface Upload { id: string; title: string; source: string }

function useUploads(api: string) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [uploading, setUploading] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api)
      if (!res.ok) return
      const data = await res.json()
      const all: Upload[] = Array.isArray(data) ? data : data.uploads ?? []
      setUploads(all.filter((d) => d.source.startsWith('upload:')))
    } catch { /* ignore */ }
  }, [api])

  useEffect(() => { refresh() }, [refresh])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(api, { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      await refresh()
    } finally {
      setUploading(false)
    }
  }, [api, refresh])

  const remove = useCallback(async (id: string) => {
    await fetch(`${api}/${id}`, { method: 'DELETE' })
    await refresh()
  }, [api, refresh])

  return { uploads, uploading, upload, remove }
}

export default function ContractReview() {
  const chat = useChat({ api: '/api/chat' })
  const { uploads, uploading, upload, remove } = useUploads(UPLOAD_API)

  const handleAttach = useCallback((files: FileList) => {
    for (const file of Array.from(files)) upload(file)
  }, [upload])

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action.prompt) chat.setInput(action.prompt)
  }, [chat.setInput])

  return (
    <ChatWithSidebar
      chat={chat}
      sidebar={{ storageKey: 'contract-review-threads' }}
      features={{ steps: true, tabs: true, sources: true, export: true }}
      models={{
        options: [
          { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'Anthropic' },
          { value: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
        ],
      }}
      attachments={{
        uploads: uploads.map((d) => ({ id: d.id, name: d.title })),
        onRemoveUpload: remove,
        onAttach: handleAttach,
        accept: ACCEPT,
        items: uploads.map((d) => ({ id: d.id, name: d.title, status: 'ready' as const }))
          .concat(uploading ? [{ id: '__uploading', name: 'Uploading...', status: 'uploading' as const }] : []),
        onRemoveItem: remove,
      }}
      quickActions={{ actions: QUICK_ACTIONS, onAction: handleQuickAction }}
      className="flex-1 min-h-0"
      placeholder="Upload a contract and ask for a review..."
      emptyState={{ title: 'Contract Review', description: 'Upload contracts for clause-by-clause analysis with redline suggestions' }}
    />
  )
}
