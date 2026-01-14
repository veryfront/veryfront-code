import { Button, LoadingButton } from "@/shared/ui/Button"
import { Card, CardDescription, CardFooter, CardTitle } from "@/shared/ui/Card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/Dialog"
import { getIFrameSrc, IFramePreview } from "@/shared/ui/IFramePreview"
import { UserAvatar } from "@/shared/ui/UserAvatar"
import { cn } from "@/shared/utils/utils"
import React from "react"

type Environment = any
type Project = any

function getMostRecentlyDeployedProductionEnvironment(
  environments: Array<Environment>,
) {
  const match = environments
    ?.filter(
      (env) =>
        !!env.deployment &&
        !(
          env.domains?.length === 1 &&
          env.domains?.at(0)?.includes(".preview.veryfront.")
        ),
    )
    ?.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    ?.at(0)

  return match
}

function getDomain(environment: Environment) {
  if (!environment?.domains) return undefined

  const filteredDomains = environment.domains
    .filter((domain) => !domain.includes(".preview.veryfront."))
    .sort((a, b) => a.length - b.length)

  return filteredDomains[0]
}

function getPreviewUrl(project: Project) {
  const latestDeployedEnvironment =
    getMostRecentlyDeployedProductionEnvironment(project.environments)
  const domain = getDomain(latestDeployedEnvironment)
  const hasPreview = latestDeployedEnvironment && domain
  if (hasPreview) {
    return `https://${domain}`
  }
  return undefined
}

function PlaceholderPreview({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-gray-100 text-gray-400 dark:bg-highlight/50 dark:text-[#55557d] truncate",
        className,
      )}
    >
      {children}
    </div>
  )
}

interface TemplateCardProps {
  project: Project
  onPreview: (previewUrl: string) => void
  onFork: (project: Project) => void | Promise<void>
  colorMode?: string
  isForkLoading?: boolean
  forkLoadingText?: string
}

export function TemplateCard({
  project,
  colorMode = "light",
  onPreview,
  onFork,
  isForkLoading = false,
  forkLoadingText = "Forking...",
  ...props
}: TemplateCardProps) {
  const [open, onOpenChange] = React.useState(false)
  const previewUrl = getPreviewUrl(project)
  const hasPreview = !!previewUrl
  const user = project.users?.at(0)

  const handlePreview = () => {
    if (previewUrl && onPreview) {
      onPreview(previewUrl)
    }
  }

  const handleFork = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onFork) {
      await onFork(project)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Card
          className="group/template hover:border-primary hover:shadow-md transition-[box-shadow,transform] duration-200 cursor-pointer flex flex-col h-full"
          {...props}
        >
          <div className="relative overflow-hidden rounded-t-lg">
            {hasPreview ? (
              <IFramePreview
                src={previewUrl}
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
            ) : (
              <PlaceholderPreview className="aspect-[8/5]">
                {project.slug}
              </PlaceholderPreview>
            )}
            <div
              className={cn(
                "absolute inset-0 bg-white/50 opacity-0 dark:bg-black/50 group-hover/template:opacity-100 transition-opacity duration-200 z-[100]",
                isForkLoading && "opacity-100",
                open && "hidden",
              )}
            />
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 translate-y-full group-hover/template:translate-y-0 transition-transform duration-200 z-[100] px-3.5 pb-2",
                isForkLoading && "translate-y-0",
                open && "hidden",
              )}
            >
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenChange(true)
                  }}
                  disabled={!hasPreview}
                >
                  Preview
                </Button>
                <LoadingButton
                  size="sm"
                  className="flex-1 disabled:opacity-100"
                  onClick={handleFork}
                  disabled={isForkLoading}
                  isLoading={isForkLoading}
                  loadingText={forkLoadingText}
                  isFixed={false}
                  data-testid={`fork-template-${project.slug}`}
                >
                  Use Template
                </LoadingButton>
              </div>
            </div>
          </div>
          <CardFooter className="flex flex-row items-center gap-3">
            {user && <UserAvatar user={user} className="size-9 shrink-0" />}
            <div className="flex-1 flex flex-col gap-px truncate">
              <CardTitle className="truncate">{project.name}</CardTitle>
              {project.config?.description && (
                <CardDescription className="truncate">
                  {project.config?.description}
                </CardDescription>
              )}
            </div>
          </CardFooter>
        </Card>
      </DialogTrigger>

      <DialogContent
        className="h-[90vh] w-[90vw] md:h-[93vh] md:max-h-[900px] md:max-w-[1400px] flex flex-col gap-5 overflow-hidden"
        withClose={false}
      >
        <DialogHeader className="relative flex md:flex-row gap-4 items-center justify-between pt-0 space-y-0">
          <div className="flex flex-row items-center gap-3.5 w-full">
            {user && <UserAvatar user={user} className="size-9 shrink-0" />}
            <div className="flex flex-col">
              <DialogTitle className="text-sm mb-0">{project.name}</DialogTitle>
              {project.config?.description && (
                <DialogDescription className="text-sm">
                  {project.config?.description}
                </DialogDescription>
              )}
            </div>
          </div>
          <aside className="flex items-center gap-3 max-md:w-full shrink-0">
            {hasPreview && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handlePreview}
                disabled={!onPreview}
              >
                Open In Browser
              </Button>
            )}
            <LoadingButton
              size="sm"
              onClick={handleFork}
              disabled={isForkLoading}
              isLoading={isForkLoading}
              loadingText={forkLoadingText}
              isFixed={false}
              data-testid={`fork-template-dialog-${project.slug}`}
            >
              Use Template
            </LoadingButton>
          </aside>
        </DialogHeader>
        <div className="h-full w-full rounded-lg flex-1 overflow-hidden border border-input-border">
          {hasPreview ? (
            <iframe
              src={getIFrameSrc(previewUrl, colorMode)}
              className="w-full h-full"
              style={{
                border: "none",
              }}
              data-testid="template-preview-iframe"
            />
          ) : (
            <PlaceholderPreview className="h-full w-full">
              {project.slug}
            </PlaceholderPreview>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
