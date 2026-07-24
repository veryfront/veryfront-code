# useVoiceInput

Speech-to-text dictation state for the composer — start/stop listening and a live transcript.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useVoiceInput } from 'veryfront/chat'
```

## Signature

The existing signature is kept unchanged:

```ts
function useVoiceInput(options?: {
  language?: string
  continuous?: boolean
  interimResults?: boolean
  onTranscript?: (transcript: string) => void
}): UseVoiceInputResult

interface UseVoiceInputResult {
  isSupported: boolean
  isListening: boolean
  transcript: string
  start: () => void
  stop: () => void
  toggle: () => void
  clear: () => void
  error: Error | null
}
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `language` | `string` | Recognition language. |
| `continuous` | `boolean` | Keep listening across pauses. |
| `interimResults` | `boolean` | Emit partial results while speaking. |
| `onTranscript` | `(transcript: string) => void` | Called as transcript text arrives. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `isSupported` | `boolean` | Whether speech recognition is available in this browser. |
| `isListening` | `boolean` | Dictation currently active. |
| `transcript` | `string` | Recognized text so far. |
| `error` | — | Recognition error, if any. |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `start` | `() => void` | Begin listening. |
| `stop` | `() => void` | Stop listening. |
| `toggle` | `() => void` | Start or stop based on current state. |
| `clear` | `() => void` | Reset the transcript. |

### Prop getters

None — voice is consumed through `useChatInput({ voice })`, which exposes `getVoiceProps` and folds the transcript into the input value. There is no userland transcript weaving.

## Example

Pass the result into the composer; the transcript folds into the field value and `ChatInput.Voice` gets `data-listening` for styling:

```tsx
function Composer({ chat }) {
  const voice = useVoiceInput({ language: 'en-US' })
  return (
    <ChatInput chat={chat} voice={voice}>
      <ChatInput.Field />
      <ChatInput.Voice className="my-mic" />   {/* style via [data-listening] */}
      <ChatInput.Submit />
    </ChatInput>
  )
}
```

At L3, the same fold happens inside the hook:

```tsx
const voice = useVoiceInput()
const chatInput = useChatInput({ chat, voice })
// chatInput.isListening, chatInput.getVoiceProps(), transcript already in chatInput.value
```

## Used by

- [`useChatInput`](./use-chat-input.md) — via the `voice` option; surfaces `isListening` and `getVoiceProps`
- [`ChatInput.Voice`](../components/chat-input.md) — the dictation toggle leaf (`data-listening`)

## Related

- [`useChatInput`](./use-chat-input.md)
- [`ChatInput`](../components/chat-input.md)
