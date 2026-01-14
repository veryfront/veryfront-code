export interface ShowcaseItem {
  title: string
  description: string
  projectSlug: string
  previewUrl: string
  features: string[]
  domain?: string
}

export interface ShowcaseModuleProps {
  items: ShowcaseItem[]
}
