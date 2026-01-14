import { useFormContext } from "https://esm.sh/react-hook-form@7.51.0"
import { ModelOption } from "@/features/agent-builder/ui/ModelOption"
import { Button } from "@/shared/ui/Button"

type FormValues = {
  prompt: string
  integrations: string[]
  model: string
}

const MODELS = [
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    desc: "Best balance of speed and intelligence",
    badge: "RECOMMENDED",
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    desc: "Most advanced OpenAI model",
    badge: "POPULAR",
  },
  {
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5",
    desc: "Most capable for complex tasks",
    badge: null,
  },
]

type ChooseModelStepProps = {
  isRedirecting: boolean
}

export function ChooseModelStep({ isRedirecting }: ChooseModelStepProps) {
  const { setValue, watch } = useFormContext<FormValues>()
  const selectedModel = watch("model")

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight mb-10">
        3. Choose Model
      </h2>

      <div role="radiogroup" className="flex flex-col gap-2">
        {MODELS.map((model) => (
          <label key={model.id} className="cursor-pointer">
            <input
              type="radio"
              name="model"
              value={model.id}
              checked={selectedModel === model.id}
              onChange={() => setValue("model", model.id)}
              className="sr-only"
            />
            <ModelOption
              id={model.id}
              name={model.name}
              desc={model.desc}
              badge={model.badge}
              selected={selectedModel === model.id}
              onSelect={() => {}}
            />
          </label>
        ))}
      </div>

      <div className="mt-10">
        <Button type="submit" variant="primary" size="lg" disabled={isRedirecting}>
          {isRedirecting ? "Creating..." : "Create Agent"}
        </Button>
      </div>
    </>
  )
}
