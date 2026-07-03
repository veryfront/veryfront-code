'use client'

import { Chat } from 'veryfront/chat'

export default function MultiAgentChat(): React.JSX.Element {
  return (
    <Chat
      agentId="orchestrator"
      api="/api/ag-ui"
      className="flex-1 min-h-0"
      placeholder="Give the team a task..."
    />
  )
}
