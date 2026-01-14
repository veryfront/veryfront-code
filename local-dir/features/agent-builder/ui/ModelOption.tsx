import { cn } from "@/shared/utils/utils"

type ModelOptionProps = {
  id: string
  name: string
  desc: string
  badge?: string | null
  selected: boolean
  onSelect: (id: string) => void
}

export function ModelOption({
  id,
  name,
  desc,
  badge,
  selected,
  onSelect,
}: ModelOptionProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3.5 p-4 border rounded-lg transition-colors",
        selected
          ? "border-primary"
          : "bg-background dark:bg-input border-border hover:border-primary",
      )}
    >
      <div
        className={cn(
          "w-5 h-5 border-[1.5px] rounded-full shrink-0 flex items-center justify-center transition-colors",
          selected ? "border-primary bg-primary" : "border-border",
        )}
      >
        {selected && <div className="w-2 h-2 bg-white rounded-full"></div>}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted mt-0.5">{desc}</div>
      </div>
      {badge && (
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wide px-2.5 py-1 rounded-full transition-colors",
            selected
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground",
          )}
        >
          {badge}
        </span>
      )}
    </div>
  )
}
