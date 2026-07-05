'use client'

import { Chat } from 'veryfront/chat'

export default function ChatPage(): React.JSX.Element {
  return <Chat agentId="assistant" api="/api/ag-ui" className="flex-1 min-h-0" placeholder="Message" />
}
