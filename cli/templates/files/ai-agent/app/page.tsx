'use client'

import { Chat, useChat } from 'veryfront/chat'

export default function ChatPage(): React.JSX.Element {
  const chat = useChat({ api: '/api/ag-ui' })

  return <Chat {...chat} className="flex-1 min-h-0" placeholder="Message" />
}
