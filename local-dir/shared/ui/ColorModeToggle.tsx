import { useTheme } from "https://esm.sh/next-themes"
import { Sun, Monitor, Moon } from "https://esm.sh/lucide-react"
import * as ToggleGroup from "https://esm.sh/@radix-ui/react-toggle-group"
import { useEffect, useState } from "react"

export function ColorModeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex items-center bg-secondary text-muted-foreground rounded-full p-1">
        <div className="w-8 h-8" />
        <div className="w-8 h-8" />
        <div className="w-8 h-8" />
      </div>
    )
  }

  return (
    <ToggleGroup.Root
      type="single"
      value={theme}
      onValueChange={(value) => {
        if (value) setTheme(value)
      }}
      className="flex items-center border border-border rounded-full p-1 gap-0.5 max-w-fit"
    >
      <ToggleGroup.Item
        value="light"
        className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 data-[state=on]:bg-secondary hover:bg-secondary/80 focus:bg-secondary/80"
        aria-label="Light mode"
      >
        <Sun className="w-4 h-4" />
      </ToggleGroup.Item>

      <ToggleGroup.Item
        value="system"
        className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 data-[state=on]:bg-secondary hover:bg-secondary/80 focus:bg-secondary/80"
        aria-label="System preference"
      >
        <Monitor className="w-4 h-4" />
      </ToggleGroup.Item>

      <ToggleGroup.Item
        value="dark"
        className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 data-[state=on]:bg-secondary hover:bg-secondary/80 focus:bg-secondary/80"
        aria-label="Dark mode"
      >
        <Moon className="w-4 h-4" />
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  )
}
