'use client'

import { Chat } from 'veryfront/chat'

export default function CodeAgent(): React.JSX.Element {
  return (
    <Chat
      agentId="coder"
      api="/api/ag-ui"
      className="flex-1 min-h-0"
      placeholder="Describe what you want to build or fix..."
    />
  )
}
