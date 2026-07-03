'use client'

import { useCallback, useMemo } from 'react'
import {
  Chat,
  ChatSidebar,
  ConversationsProvider,
  useChat,
  useUploadsRegistry,
} from 'veryfront/chat'

const UPLOAD_API = '/api/uploads'
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.mdx,.html,.rtf,.epub,.json,.xml'

const SUGGESTIONS = [
  {
    label: 'Ask Question',
    prompt: 'I have a question about this document: ',
  },
  {
    label: 'Extract Insights',
    prompt: 'Extract the key insights from the uploaded documents.',
  },
  {
    label: 'Find Sources',
    prompt: 'Find relevant sources and references in the documents for: ',
  },
]

const MODELS = [
  {
    value: 'anthropic/claude-sonnet-4-6',
    label: 'Claude Sonnet',
  },
  {
    value: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
  },
  {
    value: 'google/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    badge: 'Fast',
  },
]

function DocsChatSurface() {
  const chat = useChat({ api: '/api/ag-ui' })
  const uploads = useUploadsRegistry({ url: UPLOAD_API, storageKey: 'rag-uploads' })

  const suggestionLabels = useMemo(
    () => SUGGESTIONS.map((suggestion) => suggestion.label),
    [],
  )

  const handleSuggestionClick = useCallback((label: string) => {
    const suggestion = SUGGESTIONS.find((item) => item.label === label)
    chat.setInput(suggestion?.prompt ?? label)
  }, [chat.setInput])

  return (
    <div className="flex h-screen min-h-0 bg-[var(--background)] text-[var(--foreground)]">
      <ChatSidebar className="w-72 shrink-0 border-r border-[var(--border)]" />
      <Chat
        chat={chat}
        showSteps
        showTabs
        showSources
        agent={{
          name: 'Docs Agent',
          description: 'Upload files and ask questions',
          models: MODELS,
        }}
        suggestions={suggestionLabels}
        onSuggestionClick={handleSuggestionClick}
        uploads={uploads.items}
        onRemoveUpload={uploads.remove}
        onAttach={uploads.upload}
        onDrop={uploads.upload}
        attachAccept={ACCEPT}
        className="flex-1 min-h-0"
        placeholder="Ask anything about your documents..."
        emptyState={{ title: 'Docs Agent', description: 'Upload files and ask questions' }}
      />
    </div>
  )
}

export default function DocsChat() {
  return (
    <ConversationsProvider storageKey="rag-conversations">
      <DocsChatSurface />
    </ConversationsProvider>
  )
}
