import { Label } from "@/shared/ui/Label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/Select"

type ModelConfig = {
  model: string
  temperature: number
  maxTokens: number
  reasoningMode: string
}

type Step3ModelProps = {
  value: ModelConfig
  onChange: (value: ModelConfig) => void
}

export function Step3Model({ value, onChange }: Step3ModelProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Select
          value={value.model}
          onValueChange={(model) => onChange({ ...value, model })}
        >
          <SelectTrigger id="model" variant="solid">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-4.1" withCheck>gpt-4.1</SelectItem>
            <SelectItem value="gpt-4" withCheck>gpt-4</SelectItem>
            <SelectItem value="gpt-3.5-turbo" withCheck>gpt-3.5-turbo</SelectItem>
            <SelectItem value="claude-3-opus" withCheck>claude-3-opus</SelectItem>
            <SelectItem value="claude-3-sonnet" withCheck>claude-3-sonnet</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="temperature">Temperature: {value.temperature}</Label>
        <input
          id="temperature"
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={value.temperature}
          onChange={(e) =>
            onChange({ ...value, temperature: parseFloat(e.target.value) })
          }
          className="w-full h-2 bg-input border border-input-border rounded-lg appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="maxTokens">Max Tokens</Label>
        <Select
          value={value.maxTokens.toString()}
          onValueChange={(maxTokens) =>
            onChange({ ...value, maxTokens: parseInt(maxTokens) })
          }
        >
          <SelectTrigger id="maxTokens" variant="solid">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="512" withCheck>512</SelectItem>
            <SelectItem value="1024" withCheck>1024</SelectItem>
            <SelectItem value="2048" withCheck>2048</SelectItem>
            <SelectItem value="4096" withCheck>4096</SelectItem>
            <SelectItem value="8192" withCheck>8192</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reasoning">Reasoning</Label>
        <Select
          value={value.reasoningMode}
          onValueChange={(reasoningMode) =>
            onChange({ ...value, reasoningMode })
          }
        >
          <SelectTrigger id="reasoning" variant="solid">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enabled" withCheck>Enabled</SelectItem>
            <SelectItem value="disabled" withCheck>Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
