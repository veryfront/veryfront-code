import React from "react"
import { LoadingIcon } from "@/shared/ui/LoadingIcon"
import { XIcon, FileIcon } from "https://esm.sh/lucide-react"

export const textFileExtensions = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".cpp",
  ".c",
  ".h",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".scala",
  ".sh",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
]

export const imageFileTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]

export function isImageFile(type: string) {
  return type.startsWith("image/")
}

function isTextFile(name: string, type: string) {
  return (
    type.startsWith("text/") ||
    textFileExtensions.some((ext) => name.toLowerCase().endsWith(ext))
  )
}

async function generatePreview(url: string): Promise<AttachmentPreview> {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`,
      )
    }

    const text = await response.text()

    return {
      type: "text",
      content: text,
    }
  } catch (error) {
    console.error("Error generating preview:", error)
    return {
      type: "unsupported",
      content: null,
    }
  }
}

const loadingSpinner = (
  <LoadingIcon className="text-muted-foreground animate-spin size-4" />
)

type AttachmentPreview = {
  type: string
  content: string | ArrayBuffer
}

interface TextPreviewProps {
  name: string
  url: string
}

function TextPreview({ name, url }: TextPreviewProps) {
  const [preview, setPreview] = React.useState<AttachmentPreview>(null)
  const content = preview?.content?.toString()

  React.useEffect(() => {
    generatePreview(url)
      .then((preview) => setPreview(preview))
      .catch(() => console.warn("Preview could not be generated for " + name))
  }, [name, url, setPreview])

  if (!content) {
    return loadingSpinner
  }

  return (
    <pre className="text-[2px] text-background bg-foreground p-px text-wrap overflow-hidden size-full">
      {content.length > 500 ? content.substring(0, 500) + "..." : content}
    </pre>
  )
}

export interface ChatAttachment {
  isLoading?: boolean
  name?: string
  contentType?: string
  url: string
}

interface ChatAttachmentProps {
  attachment: ChatAttachment
  onRemove?: () => void
}

export function ChatAttachment({ attachment, onRemove }: ChatAttachmentProps) {
  if (!attachment) {
    return null
  }

  return (
    <div className="relative group shrink-0">
      <div className="border border-1 border-input-border rounded-md overflow-hidden size-12 shrink-0 relative flex items-center justify-center">
        {attachment.isLoading ? (
          loadingSpinner
        ) : (
          <>
            {isImageFile(attachment.contentType) ? (
              <img
                src={attachment.url}
                alt={`Preview of ${attachment.name}`}
                className="object-cover size-full"
              />
            ) : isTextFile(attachment.name, attachment.contentType) ? (
              <TextPreview name={attachment.name} url={attachment.url} />
            ) : (
              <FileIcon className="size-6 opacity-30 mb-[3px]" />
            )}
          </>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          className="w-3.5 h-3.5 absolute -top-1 -right-1 bg-background rounded-full border border-border opacity-0 group-hover:opacity-100 transition-opacity text-foreground inline-flex justify-center items-center"
          onClick={onRemove}
          aria-label="Remove"
        >
          <XIcon className="size-2.5" />
        </button>
      )}
    </div>
  )
}
