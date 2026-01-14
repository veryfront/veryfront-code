import { Button } from "@/shared/ui/Button"
import { IFramePreview } from "@/shared/ui/IFramePreview"
import { Card, CardTitle, CardDescription, CardLink } from "@/shared/ui/Card"

export function ShowcaseCard({ iframeSrc, href, title, subtitle, fullscreen }) {
  function onClick() {
    window.location.href = href
  }

  return (
    <Card>
      <div className="overflow-hidden px-4 pt-4">
        <div className="overflow-hidden relative">
          <IFramePreview
            src={iframeSrc}
            preventInteraction
            scaleX
            autoHeight={fullscreen ?? false}
            height={fullscreen ? undefined : 5000}
            transformOrigin="top left"
            containerClassName="aspect-video overflow-hidden rounded-t-sm"
            childStyles={{
              "scrollbar-width": "none",
              "aspect-ratio": fullscreen ? "16/9" : undefined,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center gap-2 transition-opacity opacity-0 group-hover:opacity-100 hover-none:opacity-100 bg-opacity-50 bg-black">
            <div className="flex gap-2 relative z-50">
              <Button size="sm" asChild>
                <a href={iframeSrc} target="_blank" rel="noreferrer">
                  Open
                </a>
              </Button>

              <Button size="sm" variant="secondary" asChild>
                <a
                  href={href}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClick()
                  }}
                >
                  Fork
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <CardTitle className="text-sm xl:text-sm mb-px">
          <CardLink href={iframeSrc} target="_blank" rel="noreferrer">
            {title}
          </CardLink>
        </CardTitle>
        <CardDescription className="text-sm xl:text-sm truncate">
          {subtitle}
        </CardDescription>
      </div>
    </Card>
  )
}
