'use client'

import { AttachmentsPanel, useUploadsRegistry } from 'veryfront/chat'

const UPLOAD_API = '/api/uploads'
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.mdx,.html,.rtf,.epub,.json,.xml'

export default function UploadsPage(): React.JSX.Element {
  const uploads = useUploadsRegistry({ url: UPLOAD_API, storageKey: 'rag-uploads' })

  return (
    <AttachmentsPanel
      uploads={uploads.items}
      loading={uploads.isLoading}
      onAttach={uploads.upload}
      onRemoveUpload={uploads.remove}
      attachAccept={ACCEPT}
      className="flex-1 min-h-0"
    />
  )
}
