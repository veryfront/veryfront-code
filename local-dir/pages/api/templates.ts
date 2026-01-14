export const templates = [
  {
    slug: "landing-template",
    title: "Landing Template",
    description: "Showcase your app or service.",
    isDisabled: false,
    href: "https://landing-template.veryfront.com",
    imageSrc: null,
    hasPreview: true,
    sectionName: "Use Cases",
    useCase: "Marketing",
  },
  {
    slug: "marketing-template",
    title: "Marketing Template",
    description: "Create an optimized landing page that converts.",
    isDisabled: false,
    href: "https://marketing-template.veryfront.com",
    imageSrc: null,
    hasPreview: true,
    sectionName: "Use Cases",
    useCase: "Marketing",
  },
  {
    slug: "app-template",
    title: "App Template",
    description: "Empower your clients with self-service tools.",
    isDisabled: false,
    href: "https://app-template.veryfront.com/dashboard",
    imageSrc: null,
    hasPreview: true,
    sectionName: "Use Cases",
    useCase: "Application",
  },
  {
    slug: "store-template",
    title: "Store Template",
    description: "Deliver seamless shopping experiences.",
    isDisabled: true,
    href: "https://store-template.veryfront.com",
    imageSrc:
      "https://cdn.veryfront.com/59560f7e-c4dd-4301-93dc-aed20cddc8c2/Placeholder-Image-01.svg",
    hasPreview: false,
    sectionName: "Use Cases",
    useCase: "Store",
  },
  {
    slug: "clickflow-template",
    title: "Clickflow Template",
    description: "Get feedback from your users.",
    isDisabled: true,
    href: "https://clickflow-template.veryfront.com",
    imageSrc:
      "https://cdn.veryfront.com/59560f7e-c4dd-4301-93dc-aed20cddc8c2/Placeholder-Image-01.svg",
    hasPreview: false,
    sectionName: "Use Cases",
    useCase: "Survey",
  },
]

export default async function ({req, json}) {
  return json(templates)
}

// you can call this function by visiting:
// https://veryfront.preview.veryfront.com/api/templates
