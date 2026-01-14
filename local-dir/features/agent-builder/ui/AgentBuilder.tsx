import { useState, useRef } from "react"
import { useForm, FormProvider } from "https://esm.sh/react-hook-form@7.51.0"
import { DefinePersonaStep } from "@/features/agent-builder/ui/DefinePersonaStep"
import { ConnectIntegrationsStep } from "@/features/agent-builder/ui/ConnectIntegrationsStep"
import { ChooseModelStep } from "@/features/agent-builder/ui/ChooseModelStep"
import { Container } from "@/shared/ui/Container"
import { createAgentPromptNoTools } from "@/features/agent-builder/utils/createAgentPrompt"
import { redirectToProject } from "@/features/agent-builder/utils/redirectToProject"

export type AgentBuilderFormValues = {
  prompt: string
  integrations: string[]
  model: string
}

export function AgentBuilder() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const methods = useForm<AgentBuilderFormValues>({
    defaultValues: {
      prompt: "",
      integrations: [],
      model: "gpt-5",
    },
    mode: "onSubmit",
  })

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = methods
  const formValues = watch()

  const handleToggle = (integrationName: string, checked: boolean) => {
    const current = formValues.integrations
    if (checked) {
      setValue("integrations", [...current, integrationName])
    } else {
      setValue(
        "integrations",
        current.filter((name) => name !== integrationName),
      )
    }
  }

  const onSubmit = (values: AgentBuilderFormValues) => {
    const prompt = createAgentPromptNoTools(values)
    try {
      setIsRedirecting(true)
      redirectToProject(prompt, "ai-agent-kitchen-sink", "AI Assistant")
    } catch {
      setIsRedirecting(false)
    }
  }

  const scrollToSection = (section: "persona" | "connect" | "model") => {
    const element = document.getElementById(section)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  const scrollToTop = () => {
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <FormProvider {...methods}>
      <form
        ref={formRef}
        onSubmit={handleSubmit(onSubmit, scrollToTop)}
        className="flex flex-col"
      >
        <section className="pt-16 md:pt-24 text-center bg-highlight">
          <Container size="xs">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
              Create your AI agent
            </h2>
            <p className="text-lg text-muted">
              Configure your assistant in three simple steps.
            </p>
          </Container>
        </section>

        <section id="persona" className="py-16 md:py-20 bg-highlight">
          <Container size="xs">
            <DefinePersonaStep onNext={() => scrollToSection("connect")} />
          </Container>
        </section>

        <section id="connect" className="py-16 md:py-20">
          <Container size="xs">
            <ConnectIntegrationsStep
              selectedIntegrations={formValues.integrations}
              onToggle={handleToggle}
              onNext={() => scrollToSection("model")}
            />
          </Container>
        </section>

        <section id="model" className="py-16 md:py-20 bg-highlight">
          <Container size="xs">
            <ChooseModelStep isRedirecting={isRedirecting} />
          </Container>
        </section>
      </form>
    </FormProvider>
  )
}
