import { promptPrefills } from "@/features/prompt-form/api/promptPrefills"
import React from "react"
import { Button } from "@/shared/ui/Button"

export function PromptExamples({ onSelect }) {
  const [visiblePrompts, setVisiblePrompts] = React.useState([])
  const [fadeIn, setFadeIn] = React.useState(false)

  React.useEffect(() => {
    if (promptPrefills.length >= 4) {
      const shuffled = [...promptPrefills].sort(() => 0.5 - Math.random())
      setVisiblePrompts(shuffled.slice(0, 4))
      setTimeout(() => setFadeIn(true), 50) // trigger transition after mount
    }
  }, [promptPrefills])

  return (
    <div className="flex gap-4 items-center justify-center pt-6 min-h-[64px] flex-wrap">
      {visiblePrompts?.(option) => (
        <Button
          key={option.label}
          size="xs"
          variant="outline"
          className="rounded-full border-border whitespace-nowrap"
          onClick={() => onSelect(option.prompt)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
