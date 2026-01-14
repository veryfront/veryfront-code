import { cn } from "@/shared/utils/utils"

export const productsMap = {
  studio:
    "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/icons/studio-section-icon.svg",
  components:
    "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/icons/components-section-icon.svg",
  templates:
    "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/icons/templates-section-icon.svg",
  figma_kit:
    "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/icons/figmakit-section-icon.svg",
}

export function capitalizeWords(val) {
  return String(val)
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

export function SectionMarker({ id, className }) {
  const imageSrc = productsMap[id]
  const name = capitalizeWords(id)

  return (
    <p
      className={cn(
        "flex items-center gap-2.5 md:gap-3 tracking-wider",
        className,
      )}
    >
      {imageSrc && (
        <img src={imageSrc} alt={name + " Icon"} className="shrink-0 w-5 h-5" />
      )}
      <span className="font-medium text-sm uppercase">Veryfront {name}</span>
    </p>
  )
}
