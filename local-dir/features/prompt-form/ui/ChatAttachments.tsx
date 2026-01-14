import { ChatAttachment } from "@/features/prompt-form/ui/ChatAttachment"

interface ChatAttachmentsProps {
  attachments: Array<ChatAttachment>
  onRemove: (index: number) => void
}

export function ChatAttachments({
  attachments,
  onRemove,
}: ChatAttachmentsProps) {
  if (!attachments?.length) {
    return null
  }

  return (
    <div className="flex gap-2 flex-wrap mb-1">
      {attachments?.map((attachment, index) => {
        return (
          <ChatAttachment
            key={attachment.name + index}
            attachment={attachment}
            onRemove={() => onRemove(index)}
          />
        )
      })}
    </div>
  )
}
