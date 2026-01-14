import { Button } from "@/shared/ui/Button"

type PersonaSuggestionProps = {
  name: string
  onSelect: () => void
}

export function PersonaSuggestion({ name, onSelect }: PersonaSuggestionProps) {
  return (
    <Button type="button" onClick={onSelect} variant="secondary" size="xs">
      {name}
    </Button>
  )
}
