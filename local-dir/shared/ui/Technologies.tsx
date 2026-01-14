import { Button } from "@/shared/ui/Button"
import { cn } from "@/shared/utils/utils"
import { usePageContext } from "@/lib/usePageContext"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import * as Hero from "@/shared/ui/Hero"
import { useTheme } from "https://esm.sh/next-themes"

export const logos = [
  {
    title: "React",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/logos/React_logo_white.svg",
    width: 32,
    height: 28,
  },
  {
    title: "Tailwind",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/logos/TailwindCSS_logo_white.svg",
    width: 47,
    height: 28,
  },
  {
    title: "Vite",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/logos/Vite_logo_white.svg",
    width: 40,
    height: 59,
  },
]

export function Technologies({ className }) {
  const pageContext = usePageContext()
  const { resolvedTheme } = useTheme()

  return (
    <div
      className={cn("flex flex-nowrap items-center gap-9 md:gap-8", className)}
    >
      {logos.map((logo, index) => (
        <div
          key={index}
          className="flex flex-col xs:flex-row xs:items-center gap-4 text-foreground"
        >
          <div
            className={cn(
              "shrink-0 grow-0 flex-1",
              resolvedTheme === "light" && "invert",
            )}
          >
            <img
              src={logo.imageSrc}
              alt={logo.title}
              width={logo.width}
              height={logo.height}
              className="max-h-[25px]"
            />
          </div>
          <span className="text-xs xs:text-sm md:text-base">{logo.title}</span>
        </div>
      ))}
    </div>
  )
}
