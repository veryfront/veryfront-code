'use client'

import { AttachmentsPanel, useAttachments } from 'veryfront/chat'

const UPLOAD_API = '/api/uploads'
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.mdx,.html,.rtf,.epub,.json,.xml'

export default function UploadsPage(): React.JSX.Element {
  const uploads = useAttachments({ url: UPLOAD_API, storageKey: 'rag-uploads' })
  const error = uploads.uploadError
    ?? uploads.refreshError
    ?? uploads.removeError
    ?? uploads.storageError

  return (
    <>
      {error && (
        <p role="alert" className="m-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {error.message}
        </p>
      )}
      <AttachmentsPanel
        uploads={uploads.items}
        loading={uploads.isLoading}
        onAttach={uploads.upload}
        onRemoveUpload={uploads.remove}
        attachAccept={ACCEPT}
        className="flex-1 min-h-0"
      />
    </>
  )
}
