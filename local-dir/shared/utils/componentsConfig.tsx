import { ShadcnLogo } from "@/shared/ui/icons/ShadcnLogo"
import { VeryfrontUiLogo } from "@/shared/ui/icons/VeryfrontUiLogo"
import { AiElementsLogo } from "@/shared/ui/icons/AiElementsLogo"

export const librariesConfig = [
  {
    id: "veryfront-ui",
    title: "Veryfront UI",
    description:
      "Integrate marketing UI components to elevate your next project's visual appeal and conversion rates.",
    category: "UI Library",
    icon: VeryfrontUiLogo,
    useCases: ["marketing", "application"],
  },
  {
    id: "shadcn-ui",
    title: "Shadcn UI",
    description:
      "The Foundation for your Design System. A set of beautifully designed components that you can customize, extend, and build on.",
    category: "UI Library",
    icon: ShadcnLogo,
    useCases: ["application"],
    resources: [
      {
        title: "Website",
        href: "https://ui.shadcn.com",
      },
      {
        title: "Documentation",
        href: "https://ui.shadcn.com/docs/installation",
      },
    ],
  },
  {
    id: "ai-elements",
    title: "AI Elements",
    description:
      "Custom registry built on top of shadcn/ui to help you build AI-native applications faster. It provides pre-built components like conversations, messages and more.",
    category: "UI Library",
    icon: AiElementsLogo,
    useCases: ["chatbot"],
    resources: [
      {
        title: "Website",
        href: "https://ai-sdk.dev/elements",
      },
      {
        title: "Documentation",
        href: "https://ai-sdk.dev/docs/introduction",
      },
    ],
  },
]

export const useCasesConfig = [
  {
    id: "marketing",
    title: "Marketing",
    description:
      "Integrate marketing UI components to elevate your next project's visual appeal and conversion rates.",
  },
  {
    id: "application",
    title: "Application",
    description:
      "Utilize application UI components to create a cohesive and intuitive user experience for your next project.",
  },
  {
    id: "chatbot",
    title: "Chatbot",
    description:
      "Build an AI-powered conversational interface that provides intelligent responses and interactive assistance to your users.",
  },
  {
    id: "store",
    title: "Store",
    description:
      "Use store UI components to enhance user navigation and boost conversions in your next project.",
    isDisabled: true,
  },
  {
    id: "survey",
    title: "Survey",
    description: "<todo>",
    isDisabled: true,
  },
]

export const categoriesConfig = [
  {
    id: "sections",
    title: "Sections",
  },
  {
    id: "modules",
    title: "Modules",
  },
  {
    id: "elements",
    title: "Elements",
  },
]
