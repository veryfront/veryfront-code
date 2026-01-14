import { Globe, Lock, MoreHorizontal } from "https://esm.sh/lucide-react"
import { IFramePreview } from "@/shared/ui/IFramePreview"

interface BrowserMockupProps {
  src: string
  domain?: string
  title?: string
  className?: string
  colorMode?: sring
}

export function BrowserMockup({
  src,
  domain,
  title,
  className,
  colorMode,
}: BrowserMockupProps) {
  const displayUrl = domain || new URL(src).hostname

  return (
    <div
      className={`bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200 ${className}`}
    >
      {/* Browser Chrome */}
      <div className="bg-gray-100 px-3 md:px-4 py-2 md:py-3 flex items-center gap-2 md:gap-3 border-b border-gray-200">
        {/* Traffic Lights */}
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 hover:bg-red-600 transition-colors" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 hover:bg-green-600 transition-colors" />
        </div>

        {/* Address Bar */}
        <div className="flex-1 bg-white rounded-md px-3 py-1.5 flex items-center gap-2 shadow-sm border border-gray-200 min-w-0">
          <Lock className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span className="text-sm text-gray-600 font-mono truncate">
            {displayUrl}
          </span>
        </div>

        <button className="hidden md:flex" aria-label="More options">
          <MoreHorizontal className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      <IFramePreview
        src={src}
        scaleX
        transformOrigin="top left"
        containerClassName="aspect-[8/5] overflow-hidden rounded-none"
        autoHeight={false}
        height={843}
        childStyles={{
          scrollbarWidth: "none",
          overflow: "hidden",
        }}
        preventInteraction
        colorMode={colorMode}
        data-testid="template-preview"
      />
    </div>
  )
}
