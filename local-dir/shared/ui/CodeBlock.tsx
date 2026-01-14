import React from "react"
import { Copy, Check } from "https://esm.sh/lucide-react"
import useClipboard from "https://esm.sh/react-use-clipboard"

export function CodeBlock({ children, showHeader = true, showCopy = true }) {
  const preElement = React.Children.toArray(children).find(
    (child) => child?.type === "pre",
  )

  const codeElement = preElement?.props?.children
  const className = codeElement?.props?.className || ""
  const language = className.match(/language-(\w+)/)?.[1] || "text"
  const codeContent =
    typeof codeElement?.props?.children === "string"
      ? codeElement.props.children
      : ""

  const [isCopied, onCopy] = useClipboard(codeContent, {
    successDuration: 2000,
  })

  // If showHeader is false, render a simple code block with hover copy button
  if (!showHeader) {
    return (
      <div className="relative group">
        {/* Copy Button - Top Right, shown on hover */}
        {showCopy && (
          <button
            onClick={onCopy}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Copy code"
          >
            {isCopied ? (
              <Check className="h-3 w-3 text-green-600" />
            ) : (
              <Copy className="h-3 w-3 text-foreground/70" />
            )}
          </button>
        )}
        {children}
      </div>
    )
  }

  // Standard code block with header
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Header Bar */}
      <div className="flex items-center justify-between pl-3 p-2 border-b border-border bg-background">
        {/* Language - Top Left */}
        <span className="text-xs font-medium text-muted/80 uppercase tracking-wide">
          {language}
        </span>

        {/* Copy Button - Top Right */}
        {showCopy && (
          <button
            onClick={onCopy}
            className="p-1.5 rounded-md hover:bg-muted/10 transition-colors"
            aria-label="Copy code"
          >
            {isCopied ? (
              <Check className="h-3 w-3 text-green-600" />
            ) : (
              <Copy className="h-3 w-3 text-foreground/70" />
            )}
          </button>
        )}
      </div>

      {/* Code Content */}
      <div className="overflow-x-auto not-prose px-3.5 py-2.5 text-sm">
        {children}
      </div>
    </div>
  )
}
