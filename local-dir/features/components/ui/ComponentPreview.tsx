import { Button } from "@/shared/ui/Button"
import { IFramePreview } from "@/shared/ui/IFramePreview"
import { MobileIcon } from "@/shared/ui/icons/MobileIcon"
import { TabletIcon } from "@/shared/ui/icons/TabletIcon"
import { DesktopIcon } from "@/shared/ui/icons/DesktopIcon"
import { cn } from "@/shared/utils/utils"
import { connectToChild } from "https://esm.sh/penpal@6.2.2"
import useClipboard from "https://esm.sh/react-use-clipboard@1.0.9?external=react,react-dom"
import React from "react"
import {
  Sun,
  Moon,
  Copy,
  Check,
  ExternalLink,
  Eye,
  Code,
  BookOpen,
} from "https://esm.sh/lucide-react"
import { useTheme } from "https://esm.sh/next-themes"
import { useHighlighter } from "@/shared/context/HighlighterProvider"

function getChildStyles(viewport) {
  const styles = {
    "scrollbar-width": "none",
  }

  if (!viewport) {
    return styles
  }

  const viewportWidth = viewport?.width
  const viewportHeight = viewport?.height
  const viewportMaxWidth = viewport?.maxWidth
  const viewportPaddingX = viewport?.paddingX
  const viewportPaddingY = viewport?.paddingY

  if (viewportMaxWidth || viewportWidth) {
    styles["max-width"] = `${viewportMaxWidth || viewportWidth}px`
    styles["box-sizing"] = "content-box"
    styles["margin-left"] = "auto"
    styles["margin-right"] = "auto"
  }

  if (viewportPaddingX) {
    styles["padding-left"] = viewportPaddingX
    styles["padding-right"] = viewportPaddingX
  }

  if (viewportPaddingY) {
    styles["padding-top"] = viewportPaddingY
    styles["padding-bottom"] = viewportPaddingY
  }

  if (viewportHeight) {
    styles["height"] = `${viewportHeight}px`
  }

  return styles
}

function Action({ className, ...props }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "border-foreground/20 shadow-sm gap-2 whitespace-nowrap",
        className,
      )}
      {...props}
    />
  )
}

function ViewportButtons({ onClick }) {
  return (
    <div className="flex gap-2">
      <Action
        className="w-[34px] h-[34px] p-0"
        onClick={() => onClick?.("lg")}
        aria-label="Desktop View"
      >
        <DesktopIcon width={16} height={16} />
      </Action>
      <Action
        className="w-[34px] h-[34px] p-0"
        onClick={() => onClick?.("md")}
        aria-label="Tablet View"
      >
        <TabletIcon width={14} height={14} />
      </Action>
      <Action
        className="w-[34px] h-[34px] p-0"
        onClick={() => onClick?.("sm")}
        aria-label="Mobile View"
      >
        <MobileIcon width={16} height={16} />
      </Action>
    </div>
  )
}

const canavsStyles =
  "bg-[url(https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/photoshop-canvas.svg)] bg-repeat"

export function ComponentPreview({ component }) {
  const code = component.code?.trim()
  const frontmatter = component.frontmatter ?? {}
  const documentation = frontmatter?.metadata?.documentation
  const docsUrl =
    typeof documentation === "string" ? documentation : documentation?.human
  const isPreviewless = frontmatter.metadata?.isPreviewless
  const viewport = frontmatter.metadata?.viewport
  const { resolvedTheme } = useTheme()

  const [tab, setTab] = React.useState(isPreviewless ? "mdx" : "preview")
  const [iframeHeight, setIFrameHeight] = React.useState(0)
  const [breakpoint, setBreakpoint] = React.useState("lg")
  const [colorMode, setColorMode] = React.useState(resolvedTheme ?? "light")

  React.useEffect(() => {
    setColorMode(resolvedTheme)
  }, [resolvedTheme, setColorMode])

  const [isCopied, onCopy] = useClipboard(code, {
    successDuration: 2000,
  })

  const iframeSrc = `https://${component.librarySlug}.veryfront.com${component.importPath}`
  const newWindowSrc = `${iframeSrc}?color_mode=${colorMode}`

  const [html, setHTML] = React.useState<string>(undefined)
  const { highlighter, highlighterLoading } = useHighlighter()

  React.useEffect(() => {
    // Only process code when the accordion is open and highlighter is ready
    if (!highlighter || highlighterLoading) {
      return
    }

    async function processCode() {
      try {
        // For light mode, we'll need to use a light theme or adjust the colors
        const html = await highlighter.codeToHtml(code.trim(), {
          lang: "mdx",
          theme: resolvedTheme === "light" ? "github-light" : "github-dark",
        })
        setHTML(html)
      } catch (error) {
        console.log({ error })
        // this can error silently due to invalid mdx during streaming
      }
    }

    void processCode()
  }, [code, resolvedTheme, highlighter, highlighterLoading])

  return (
    <div className="border border-border rounded-xl overflow-hidden w-full max-w-full bg-[#FAFAFA] dark:bg-card">
      <div className="flex items-center p-4 border-b-primary/10">
        <div className="flex-1">
          {!isPreviewless && (
            <Action
              onClick={() => setTab(tab === "preview" ? "mdx" : "preview")}
            >
              {tab === "mdx" ? (
                <>
                  <Eye width={15} height={15} />
                  Show Preview
                </>
              ) : (
                <>
                  <Code width={15} height={15} />
                  Show Code
                </>
              )}
            </Action>
          )}
        </div>
        <div className="flex-1 hidden sm:flex justify-center">
          {tab === "preview" && <ViewportButtons onClick={setBreakpoint} />}
        </div>
        <div className="flex-1 flex justify-end gap-2">
          {tab === "preview" && (
            <Action
              onClick={() => {
                window.open(newWindowSrc, "_blank", "noopener,noreferrer")
              }}
              className="w-[34px] h-[34px] p-0"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Action>
          )}

          {tab === "preview" && (
            <Action
              onClick={() =>
                setColorMode(colorMode === "light" ? "dark" : "light")
              }
              className="w-[34px] h-[34px] p-0"
            >
              {colorMode === "light" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
            </Action>
          )}

          {docsUrl && (
            <Action
              onClick={() => {
                window.open(docsUrl, "_blank", "noopener,noreferrer")
              }}
              className="w-[34px] h-[34px] p-0"
              aria-label="Documentation"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Action>
          )}

          <Action
            onClick={onCopy}
            className="w-[34px] h-[34px] p-0"
            aria-label="Copy Code"
          >
            {isCopied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Action>
        </div>
      </div>
      <div className={cn(tab !== "preview" ? "hidden" : "", canavsStyles)}>
        <div
          className={cn(
            "mx-auto",
            breakpoint === "sm" && "sm:max-w-[320px]",
            breakpoint === "md" && "sm:max-w-[768px]",
            breakpoint === "lg" && "sm:max-w-full",
          )}
        >
          <IFramePreview
            src={iframeSrc}
            height={viewport?.height}
            autoHeight={!viewport?.height}
            childStyles={getChildStyles(viewport)}
            colorMode={colorMode}
          />
        </div>
      </div>

      {tab === "mdx" && (
        <div
          className={cn(
            "max-h-[calc(25rem)] md:max-h-[30rem] lg:max-h-[35rem] vf-code h-full overflow-y-scroll bg-[#24292e]",
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}
